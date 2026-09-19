import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AssessmentRunner } from "./runner";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session?.orgId) notFound();
  const supabase = await createClient();
  const { data: assignment } = await supabase.from("assessment_assignments")
    .select("id, status, assessments(id, title, description, pass_percent, max_attempts, time_limit_minutes)")
    .eq("assessment_id", id).eq("user_id", session.userId).eq("org_id", session.orgId).single();
  if (!assignment) notFound();
  const assessment = assignment.assessments as unknown as {
    id: string; title: string; description: string | null; pass_percent: number; max_attempts: number; time_limit_minutes: number | null;
  };
  const admin = createAdminClient();
  const { count: attemptCount } = await admin.from("assessment_attempts")
    .select("id", { count: "exact", head: true }).eq("assignment_id", assignment.id);

  // The attempt itself (which questions, when the clock started) is not
  // drawn here — that only happens on an explicit "Start assessment →"
  // click (POST /api/v1/assessments/[id]/start), so a timed exam's clock
  // never starts just from viewing the intro screen. This page only needs
  // to know whether an attempt is already in progress, to resume the
  // runner straight into the timed form on a page refresh rather than
  // re-showing the intro and silently losing the learner's place.
  const { data: inProgress } = await admin.from("assessment_assignments")
    .select("current_attempt_question_ids").eq("id", assignment.id).single();

  return (
    <AssessmentRunner
      assessment={assessment}
      attemptsUsed={attemptCount ?? 0}
      hasAttemptInProgress={!!inProgress?.current_attempt_question_ids}
    />
  );
}
