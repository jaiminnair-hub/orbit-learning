import type { SupabaseClient } from "@supabase/supabase-js";
import { getSessionContext } from "@/lib/auth/session";
import { hasRole } from "@/lib/auth/roles";
import { getPlatformAccess } from "@/lib/auth/platform";
import { errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCompletionRows } from "@/lib/lms/completion";

/**
 * CSV export of the same progress data Assign & Track (org scope) and
 * Platform Control's Activity & audit tab (platform scope) already show —
 * built from buildCompletionRows(), the same function the report and the
 * learner's own dashboard use, so the export can never disagree with the
 * screen it was downloaded from.
 */

const STATUS_LABEL: Record<string, string> = {
  enrolled: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  expired: "Expired",
  withdrawn: "Withdrawn",
  assigned: "Not attempted",
  submitted: "Submitted",
  passed: "Passed",
};

const HEADER = ["Organisation", "Learner", "Email", "Kind", "Item", "Status", "Progress", "Due", "Completed"];

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function toCsv(rows: string[][]): string {
  return [HEADER, ...rows].map((line) => line.map(csvEscape).join(",")).join("\n");
}

function day(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "";
}

interface AssignmentRow {
  status: string;
  due_date: string | null;
  completed_at: string | null;
  profiles: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
  assessments: { title: string } | { title: string }[] | null;
}

async function orgRows(client: SupabaseClient, orgId: string, orgName: string): Promise<string[][]> {
  const [courseRows, { data: assignments }] = await Promise.all([
    buildCompletionRows(client, orgId),
    client
      .from("assessment_assignments")
      // assessment_assignments has two FKs into profiles (user_id and
      // assigned_by) — the relationship must be named explicitly or
      // PostgREST rejects the embed as ambiguous (PGRST201).
      .select("status, due_date, completed_at, profiles!assessment_assignments_user_id_fkey(full_name, email), assessments(title)")
      .eq("org_id", orgId),
  ]);

  const courseLines = courseRows.map((row) => [
    orgName,
    row.learnerName,
    row.learnerEmail,
    "Course",
    row.courseTitle,
    STATUS_LABEL[row.status] ?? row.status,
    `${row.percent}%`,
    day(row.dueDate),
    day(row.completedAt),
  ]);

  const assessmentLines = ((assignments ?? []) as unknown as AssignmentRow[]).map((assignment) => {
    const profile = Array.isArray(assignment.profiles) ? assignment.profiles[0] : assignment.profiles;
    const assessment = Array.isArray(assignment.assessments) ? assignment.assessments[0] : assignment.assessments;
    return [
      orgName,
      profile?.full_name ?? profile?.email ?? "Unknown",
      profile?.email ?? "",
      "Assessment",
      assessment?.title ?? "Untitled assessment",
      STATUS_LABEL[assignment.status] ?? assignment.status,
      "",
      day(assignment.due_date),
      day(assignment.completed_at),
    ];
  });

  return [...courseLines, ...assessmentLines];
}

export async function GET(request: Request) {
  const session = await getSessionContext();
  if (!session) return errorResponse("UNAUTHENTICATED", "Sign in required.", 401);

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "platform" ? "platform" : "org";

  let rows: string[][] = [];
  let filename: string;

  if (scope === "platform") {
    const access = await getPlatformAccess();
    if (!access) return errorResponse("FORBIDDEN", "Platform admin access required.", 403);

    // assessment_assignments' own RLS policy (unlike most tables here) has
    // no is_platform_admin() branch, so a platform-wide export goes through
    // the admin client rather than the caller's own session client.
    const admin = createAdminClient();
    const { data: orgs } = await admin.from("organizations").select("id, name").order("name");
    for (const org of orgs ?? []) {
      rows.push(...(await orgRows(admin, org.id as string, org.name as string)));
    }

    await admin.from("activity_log").insert({
      org_id: null,
      actor_id: session.userId,
      event_type: "platform_admin.reports.export",
      entity_type: "reports",
      metadata: { orgCount: orgs?.length ?? 0, rowCount: rows.length },
      is_platform_admin_action: true,
    });

    filename = `orbit-platform-report-${new Date().toISOString().slice(0, 10)}.csv`;
  } else {
    if (!session.orgId || !hasRole(session.role, "manager")) {
      return errorResponse("FORBIDDEN", "Requires at least the 'manager' role.", 403);
    }
    const supabase = await createClient();
    const { data: org } = await supabase.from("organizations").select("name").eq("id", session.orgId).single();
    rows = await orgRows(supabase, session.orgId, org?.name ?? "Your organisation");
    filename = `orbit-report-${new Date().toISOString().slice(0, 10)}.csv`;
  }

  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
