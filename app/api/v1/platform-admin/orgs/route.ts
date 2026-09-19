import { getSessionContext } from "@/lib/auth/session";
import { successResponse, errorResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformOwner } from "@/lib/auth/platform";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "org";
}

// Platform-admin cross-tenant path (docs/MULTI_TENANCY.md §4). Deliberately
// not built on withAuth({ minRole }) — platform admin is a separate grant
// via the platform_admins table, not a rank in the tenant role hierarchy
// (learner < manager < org_admin < org_owner).
//
// The read itself is RLS-permitted on the caller's own session client
// (every table's _select policy carries `or is_platform_admin()`) — no
// service-role needed to see the data. The service-role client is used
// only to write the activity_log row: RLS intentionally has no insert
// policy for `authenticated` on activity_log (service-role only, by
// design), and every cross-tenant read must be logged since RLS can
// permit a SELECT but cannot trigger an audit row on one.
export async function GET() {
  const session = await getSessionContext();
  if (!session) {
    return errorResponse("UNAUTHENTICATED", "Sign in required.", 401);
  }

  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) {
    return errorResponse("FORBIDDEN", "Platform admin access required.", 403);
  }

  const { data: orgs, error } = await supabase
    .from("organizations")
    .select("id, name, slug, seats, is_active, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return errorResponse("QUERY_FAILED", error.message, 500);
  }

  const admin = createAdminClient();
  const orgIds = (orgs ?? []).map((org) => org.id);
  const [{ data: profiles }, { data: invitations }, { data: courses }, { data: activity }] = orgIds.length
    ? await Promise.all([
        admin.from("profiles").select("org_id").in("org_id", orgIds).is("deleted_at", null),
        admin.from("org_invitations").select("org_id").in("org_id", orgIds).eq("status", "pending"),
        admin.from("courses").select("org_id").in("org_id", orgIds).eq("status", "published").is("deleted_at", null),
        admin.from("activity_log").select("id, event_type, created_at, org_id, is_platform_admin_action").order("created_at", { ascending: false }).limit(20),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const countByOrg = (rows: { org_id: string }[] | null) => {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) counts.set(row.org_id, (counts.get(row.org_id) ?? 0) + 1);
    return counts;
  };
  const memberCount = countByOrg(profiles);
  const invitationCount = countByOrg(invitations);
  const courseCount = countByOrg(courses);

  await admin.from("activity_log").insert({
    org_id: null,
    actor_id: session.userId,
    event_type: "platform_admin.orgs.read",
    entity_type: "organizations",
    metadata: { count: orgs?.length ?? 0 },
    is_platform_admin_action: true,
  });

  return successResponse({
    orgs: (orgs ?? []).map((org) => ({
      ...org,
      memberCount: memberCount.get(org.id) ?? 0,
      pendingInvitations: invitationCount.get(org.id) ?? 0,
      publishedCourses: courseCount.get(org.id) ?? 0,
    })),
    activity: activity ?? [],
  });
}

// A platform owner can create a completely separate LMS tenant and give its
// first owner an invitation. This never moves an existing account from one
// org to another; that single-org-profile constraint is enforced below.
export async function POST(request: Request) {
  const access = await requirePlatformOwner();
  if (!access) return errorResponse("FORBIDDEN", "Platform owner access required.", 403);

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const ownerEmail = typeof body?.ownerEmail === "string" ? body.ownerEmail.trim().toLowerCase() : "";
  if (!name || !EMAIL_RE.test(ownerEmail)) {
    return errorResponse("INVALID_INPUT", "Organization name and a valid initial owner email are required.", 400);
  }

  const admin = createAdminClient();
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("org_id")
    .eq("email", ownerEmail)
    .is("deleted_at", null)
    .maybeSingle();
  if (existingProfile?.org_id) {
    return errorResponse(
      "OWNER_ALREADY_ASSIGNED",
      "That email already belongs to an organization. Do not move people between organizations from this console.",
      409
    );
  }

  let organization: { id: string; name: string; slug: string; seats: number; is_active: boolean } | null = null;
  const base = slugify(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${crypto.randomUUID().slice(0, 5)}`;
    const { data, error } = await admin
      .from("organizations")
      .insert({ name, slug })
      .select("id, name, slug, seats, is_active")
      .single();
    if (!error) { organization = data; break; }
    if (error.code !== "23505") return errorResponse("CREATE_FAILED", error.message, 500);
  }
  if (!organization) return errorResponse("CREATE_FAILED", "Could not allocate an organization identifier.", 500);

  const token = crypto.randomUUID();
  const { error: inviteError } = await admin.from("org_invitations").insert({
    org_id: organization.id,
    email: ownerEmail,
    role: "org_owner",
    token,
    invited_by: access.session.userId,
  });
  if (inviteError) {
    await admin.from("organizations").delete().eq("id", organization.id);
    return errorResponse("CREATE_FAILED", inviteError.message, 500);
  }

  await admin.from("activity_log").insert({
    org_id: organization.id,
    actor_id: access.session.userId,
    event_type: "platform_owner.organization.created",
    entity_type: "organizations",
    entity_id: organization.id,
    metadata: { ownerEmail },
    is_platform_admin_action: true,
  });
  return successResponse({ organization, ownerInvitation: { email: ownerEmail, token } }, 201);
}
