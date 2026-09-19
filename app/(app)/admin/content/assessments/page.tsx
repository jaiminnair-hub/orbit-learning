import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AssessmentsConsole } from "./assessments-console";

export default async function AssessmentsPage() {
  const session = await getSessionContext();
  const supabase = await createClient();
  const [assessments, people] = await Promise.all([
    supabase.from("assessments").select("id, title, description, status, pass_percent, max_attempts, time_limit_minutes, question_pool_size, randomize_questions, created_at").eq("org_id", session!.orgId).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, email, full_name").eq("org_id", session!.orgId).is("deleted_at", null).order("email"),
  ]);
  return <AssessmentsConsole initialAssessments={assessments.data ?? []} people={people.data ?? []} />;
}
