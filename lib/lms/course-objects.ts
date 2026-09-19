import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolving a course down to the learning objects it contains.
 *
 * Completion is derived from these ids rather than self-reported, so this
 * walk decides what "100%" means. It was previously inlined in the
 * progress route; reporting needs the same answer for many courses at
 * once, and two implementations of "what is in this course" would drift
 * into two different completion percentages for the same learner.
 */

type Client = SupabaseClient;

/**
 * Learning-object ids for several courses at once, as a map keyed by
 * course id. Courses with no content resolve to an empty array, which the
 * caller must treat as "0%" rather than "complete" — an empty course is
 * not a finished one.
 */
export async function learningObjectIdsForCourses(
  supabase: Client,
  courseIds: string[]
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>(courseIds.map((id) => [id, []]));
  if (!courseIds.length) return result;

  const { data: modules } = await supabase
    .from("modules")
    .select("id, course_id")
    .in("course_id", courseIds);
  if (!modules?.length) return result;

  const moduleToCourse = new Map(modules.map((m) => [m.id, m.course_id as string]));

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, module_id")
    .in("module_id", [...moduleToCourse.keys()]);
  if (!lessons?.length) return result;

  const lessonToCourse = new Map(
    lessons.map((l) => [l.id, moduleToCourse.get(l.module_id as string)!])
  );

  const { data: links } = await supabase
    .from("lesson_learning_objects")
    .select("lesson_id, learning_object_id")
    .in("lesson_id", [...lessonToCourse.keys()]);
  if (!links?.length) return result;

  // A learning object reused across two lessons of the same course counts
  // once — that reuse is the whole point of the content model, and
  // double-counting it would make a course impossible to finish.
  const perCourse = new Map<string, Set<string>>();
  for (const link of links) {
    const courseId = lessonToCourse.get(link.lesson_id as string);
    if (!courseId) continue;
    if (!perCourse.has(courseId)) perCourse.set(courseId, new Set());
    perCourse.get(courseId)!.add(link.learning_object_id as string);
  }

  for (const [courseId, ids] of perCourse) result.set(courseId, [...ids]);
  return result;
}

/** Single-course convenience wrapper. */
export async function learningObjectIdsForCourse(
  supabase: Client,
  courseId: string
): Promise<string[]> {
  const map = await learningObjectIdsForCourses(supabase, [courseId]);
  return map.get(courseId) ?? [];
}

export function percentComplete(total: number, completed: number): number {
  if (total <= 0) return 0;
  return Math.round((completed / total) * 100);
}
