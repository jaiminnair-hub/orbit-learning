import type { SupabaseClient } from "@supabase/supabase-js";

export type LearnerSearchKind = "course" | "learning_path" | "assessment" | "certificate" | "course_page";

export interface LearnerSearchResult {
  kind: LearnerSearchKind;
  id: string;
  title: string;
  description: string | null;
  context: string | null;
  href: string;
}

function includesQuery(values: unknown[], query: string) {
  const needle = query.toLocaleLowerCase();
  return values.some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(needle));
}

function snippet(content: string, query: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  const index = normalized.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, index < 0 ? 0 : index - 80);
  const end = Math.min(normalized.length, start + 220);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
}

export async function searchLearnerWorkspace(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  params: { orgId: string; userId: string; query: string }
): Promise<LearnerSearchResult[]> {
  const pattern = `%${params.query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const [coursesResult, pathsResult, assignmentsResult, certificatesResult, pagesResult] = await Promise.all([
    supabase
      .from("courses")
      .select("id, title, description")
      .eq("org_id", params.orgId)
      .eq("status", "published")
      .is("deleted_at", null)
      .textSearch("search_vector", params.query, { type: "websearch", config: "english" })
      .limit(20),
    supabase
      .from("learning_paths")
      .select("id, title, description")
      .eq("org_id", params.orgId)
      .eq("status", "published")
      .is("deleted_at", null)
      .limit(100),
    supabase
      .from("assessment_assignments")
      .select("assessment_id, assessments!inner(id, title, description, status)")
      .eq("org_id", params.orgId)
      .eq("user_id", params.userId)
      .limit(100),
    supabase
      .from("certificates")
      .select("id, title, source_type, issued_at")
      .eq("org_id", params.orgId)
      .eq("user_id", params.userId)
      .limit(100),
    admin
      .from("ai_knowledge_chunks")
      .select("id, course_id, learning_object_id, course_title, module_title, lesson_title, page_title, content")
      .eq("org_id", params.orgId)
      .ilike("content", pattern)
      .limit(20),
  ]);

  if (coursesResult.error) throw new Error(`Course search failed: ${coursesResult.error.message}`);
  if (pathsResult.error) throw new Error(`Learning path search failed: ${pathsResult.error.message}`);
  if (assignmentsResult.error) throw new Error(`Assessment search failed: ${assignmentsResult.error.message}`);
  if (certificatesResult.error) throw new Error(`Certificate search failed: ${certificatesResult.error.message}`);
  // The private Guide index may not have been populated yet. That should not
  // make the rest of workspace search fail; it only means page-level matches
  // are unavailable until the published index has been built.
  const pageRows = pagesResult.error ? [] : pagesResult.data ?? [];

  const courses: LearnerSearchResult[] = (coursesResult.data ?? []).map((row) => ({
    kind: "course",
    id: String(row.id),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    context: "Published course",
    href: `/courses/${row.id}`,
  }));
  const paths: LearnerSearchResult[] = (pathsResult.data ?? [])
    .filter((row) => includesQuery([row.title, row.description], params.query))
    .map((row) => ({ kind: "learning_path", id: String(row.id), title: String(row.title), description: row.description ? String(row.description) : null, context: "Published learning path", href: `/paths/${row.id}` }));
  const assessments: LearnerSearchResult[] = (assignmentsResult.data ?? []).flatMap((row) => {
    const relation = Array.isArray(row.assessments) ? row.assessments[0] : row.assessments;
    if (!relation || relation.status !== "published" || !includesQuery([relation.title, relation.description], params.query)) return [];
    return [{ kind: "assessment" as const, id: String(relation.id), title: String(relation.title), description: relation.description ? String(relation.description) : null, context: "Assigned assessment", href: `/assessments/${relation.id}` }];
  });
  const certificates: LearnerSearchResult[] = (certificatesResult.data ?? [])
    .filter((row) => includesQuery([row.title, row.source_type], params.query))
    .map((row) => ({ kind: "certificate", id: String(row.id), title: String(row.title), description: null, context: `Certificate · ${new Date(String(row.issued_at)).toLocaleDateString()}`, href: `/certificates/${row.id}` }));
  const seenPages = new Set<string>();
  const pages: LearnerSearchResult[] = pageRows.flatMap((row) => {
    const key = `${row.course_id}:${row.learning_object_id}:${row.page_title ?? row.id}`;
    if (seenPages.has(key)) return [];
    seenPages.add(key);
    return [{
      kind: "course_page" as const,
      id: String(row.id),
      title: String(row.page_title || row.lesson_title || row.course_title),
      description: snippet(String(row.content), params.query),
      context: [row.course_title, row.module_title, row.lesson_title].filter(Boolean).join(" · "),
      href: `/courses/${row.course_id}`,
    }];
  });

  return [...courses, ...paths, ...assessments, ...certificates, ...pages];
}
