import type { SupabaseClient } from "@supabase/supabase-js";

// Widened in Phase 3 step 4, which also widened content_versions'
// entity_type check constraint (20260820143000_content_versions_entity_types.sql).
// The polymorphic design from Phase 2 was built for exactly this: course
// specifications and saved blocks get the same immutable publish snapshot
// that learning objects and courses already had, with no new table.
export type VersionableEntity =
  | "learning_object"
  | "course"
  | "content_asset"
  | "assessment"
  | "course_specification"
  | "component_definition";

// The state machine from docs/CONTENT_MODEL.md §6. Note there is no
// published → draft edge: publishing a *new* version starts a fresh
// draft on top of the still-live published version, rather than pulling
// the live one back into an editable state.
const ALLOWED: Record<string, string[]> = {
  draft: ["review", "archived"],
  review: ["approval", "draft", "archived"],
  approval: ["published", "draft", "archived"],
  published: ["archived"],
  archived: ["draft"],
};

export function canTransition(from: string, to: string): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function transitionError(from: string, to: string): string {
  return `Cannot move content from '${from}' to '${to}'. Allowed: ${(ALLOWED[from] ?? []).join(", ") || "none"}.`;
}

// Writes the immutable snapshot that makes in-progress learners immune to
// later edits. Uses the service-role client because content_versions has
// no insert policy for `authenticated` by design — it's an audit record,
// written only by this path, never directly by a client.
export async function snapshotVersion(
  admin: SupabaseClient,
  params: {
    orgId: string;
    entityType: VersionableEntity;
    entityId: string;
    versionNumber: number;
    snapshot: unknown;
    publishedBy: string;
  }
): Promise<{ error: string | null }> {
  const { error } = await admin.from("content_versions").insert({
    org_id: params.orgId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    version_number: params.versionNumber,
    snapshot: params.snapshot,
    published_by: params.publishedBy,
  });
  return { error: error?.message ?? null };
}
