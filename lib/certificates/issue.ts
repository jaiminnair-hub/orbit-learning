import { createAdminClient } from "@/lib/supabase/admin";
import { logActivity } from "@/lib/activity-log";

/**
 * Shared by both certificate-issuing hook points
 * (app/api/v1/assessments/[id]/submit/route.ts on a pass,
 * app/api/v1/progress/route.ts on course completion). Always writes via
 * the service role — certificates has no insert policy for the
 * authenticated role at all (see the migration's comment for why: a
 * plain self-scoped policy would let a learner mint their own fake
 * certificate). The caller is responsible for having already verified
 * the pass/completion decision from the caller's own session before
 * calling this.
 *
 * Check-then-insert, not insert-and-catch: the course-completion hook
 * recomputes "is this course done" on every progress write once it's
 * done, not just the first, so this runs far more often as a cheap
 * existence check than as an actual insert. A 23505 (unique violation)
 * is still handled, for the genuine race — e.g. the last two learning
 * objects in a course completing from two concurrent requests — by
 * fetching whichever row won rather than treating it as a failure.
 */

interface IssueCertificateInput {
  orgId: string;
  userId: string;
  sourceType: "assessment" | "course";
  sourceId: string;
  title: string;
  recipientName: string;
  /** Only for assessment-sourced certificates; null for course completion. */
  scorePercent: number | null;
}

export async function issueCertificate(input: IssueCertificateInput): Promise<string | null> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("certificates")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("user_id", input.userId)
    .eq("source_type", input.sourceType)
    .eq("source_id", input.sourceId)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from("certificates")
    .insert({
      org_id: input.orgId,
      user_id: input.userId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      title: input.title,
      recipient_name: input.recipientName,
      score_percent: input.scorePercent,
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    const { data: won } = await admin
      .from("certificates")
      .select("id")
      .eq("org_id", input.orgId)
      .eq("user_id", input.userId)
      .eq("source_type", input.sourceType)
      .eq("source_id", input.sourceId)
      .single();
    return won?.id ?? null;
  }

  // A certificate-issuance failure must not fail the request that
  // triggered it — the underlying attempt/progress write already
  // succeeded and is real regardless of whether a certificate followed.
  if (error) {
    console.error("issueCertificate: insert failed", error.message);
    return null;
  }

  await logActivity(admin, {
    orgId: input.orgId,
    actorId: input.userId,
    eventType: "org.certificate.issued",
    entityType: "certificates",
    entityId: created.id,
    metadata: { sourceType: input.sourceType, sourceId: input.sourceId, title: input.title },
  });

  return created.id;
}
