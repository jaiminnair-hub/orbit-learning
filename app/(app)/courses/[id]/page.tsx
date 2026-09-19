import Link from "next/link";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/shell/Shell";
import { RedirectToLogin } from "@/components/auth/RedirectToLogin";
import { CoursePlayer } from "./player";

export default async function CoursePlayerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // SCORM requires a learner identity: packages read cmi.core.student_id
  // and student_name at startup, and some print the name on their own
  // completion screen. Resolved server-side from the session rather than
  // trusted from the client, since it ends up inside tracking records.
  const session = await getSessionContext();
  if (!session) return <RedirectToLogin />;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", session.userId)
    .maybeSingle();

  return (
    <PageShell maxWidth="68rem">
      <p className="mb-4">
        <Link href="/courses" className="text-sm text-accent hover:underline">
          ← All courses
        </Link>
      </p>
      <CoursePlayer
        courseId={id}
        learnerId={session.userId}
        learnerName={profile?.full_name || session.email}
      />
    </PageShell>
  );
}
