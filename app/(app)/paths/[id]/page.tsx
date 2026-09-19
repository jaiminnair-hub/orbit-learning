import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { courseIdsForPath, computePathProgress } from "@/lib/lms/learning-paths";
import { Card } from "@/components/shell/Shell";

export default async function LearningPathPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionContext();
  if (!session?.orgId) notFound();
  const supabase = await createClient();

  const { data: path } = await supabase
    .from("learning_paths")
    .select("id, title, description, status")
    .eq("id", id)
    .eq("org_id", session.orgId)
    .single();
  if (!path) notFound();

  const courseIds = await courseIdsForPath(supabase, id);
  const { data: courses } = courseIds.length
    ? await supabase.from("courses").select("id, title, slug").in("id", courseIds)
    : { data: [] };
  const courseById = new Map((courses ?? []).map((c) => [c.id, c]));

  const { data: courseEnrollments } = courseIds.length
    ? await supabase
        .from("enrollments")
        .select("enrollable_id, status")
        .eq("org_id", session.orgId)
        .eq("user_id", session.userId)
        .eq("enrollable_type", "course")
        .in("enrollable_id", courseIds)
    : { data: [] };
  const courseStatus = new Map((courseEnrollments ?? []).map((e) => [e.enrollable_id as string, e.status as string]));

  const progress = await computePathProgress(supabase, { orgId: session.orgId, userId: session.userId, pathId: id });

  return (
    <main className="learning-path-page">
      <Link href="/dashboard">← Learning home</Link>
      <section className="learning-path-page__hero">
        <p>Learning path · {progress.completedCourses} of {progress.totalCourses} courses complete</p>
        <h1>{path.title}</h1>
        {path.description && <span>{path.description}</span>}
        <div className="learning-path-page__bar" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${progress.percent}%` }} />
        </div>
      </section>

      <ol className="learning-path-page__list">
        {courseIds.map((courseId, index) => {
          const course = courseById.get(courseId);
          const status = courseStatus.get(courseId) ?? "not_started";
          const done = status === "completed";
          return (
            <li key={courseId}>
              <Card className="learning-path-page__course">
                <span className="learning-path-page__index">{String(index + 1).padStart(2, "0")}</span>
                <span className="learning-path-page__body">
                  <strong>{course?.title ?? "Untitled course"}</strong>
                  <small>{done ? "Completed" : status === "in_progress" ? "In progress" : status === "enrolled" ? "Not started" : "Not yet started"}</small>
                </span>
                <Link href={`/courses/${courseId}`}>{done ? "Review →" : "Open →"}</Link>
              </Card>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
