import Link from "next/link";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { buildCompletionRows } from "@/lib/lms/completion";
import { CoursesCatalogue } from "./courses-catalogue";

// Learner-facing catalogue. Published courses come from the organization;
// progress comes from the same shared completion calculation used in reports,
// so a learner never sees a different percentage here than elsewhere.
export default async function CoursesPage() {
  const session = await getSessionContext();
  const supabase = await createClient();

  const [{ data: courses }, completionRows] = await Promise.all([
    supabase
      .from("courses")
      .select("id, title, description, slug, published_at")
      .eq("org_id", session?.orgId ?? "")
      .eq("status", "published")
      .is("deleted_at", null)
      .order("published_at", { ascending: false }),
    session?.orgId ? buildCompletionRows(supabase, session.orgId, { userId: session.userId }) : [],
  ]);

  const progressByCourse = new Map(completionRows.map((row) => [row.courseId, row]));
  const catalogueCourses = (courses ?? []).map((course) => {
    const progress = progressByCourse.get(course.id);
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      enrolled: Boolean(progress),
      percent: progress?.percent ?? 0,
      completed: progress?.status === "completed",
      dueDate: progress?.dueDate ?? null,
    };
  });

  return (
    <main className="catalogue-page">
      <section className="catalogue-hero">
        <div>
          <p className="catalogue-hero__eyebrow">Orbit Learning</p>
          <h1>Make progress that matters.</h1>
          <p>
            A clear place to continue what you have started, discover what is next, and build real capability.
          </p>
        </div>
        <div className="catalogue-hero__signal" aria-label={`${catalogueCourses.length} published courses available`}>
          <span>{catalogueCourses.length}</span>
          <small>published course{catalogueCourses.length === 1 ? "" : "s"}<br />available to explore</small>
        </div>
      </section>

      <CoursesCatalogue courses={catalogueCourses} />

      <p className="catalogue-page__back">
        <Link href="/dashboard">← Back to your learning home</Link>
      </p>
    </main>
  );
}
