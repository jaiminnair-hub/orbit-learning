import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMyWorkRows, isDone, type WorkRow } from "./my-work";

export interface SkillTagRow {
  id: string;
  name: string;
  description: string | null;
  external_ref: string | null;
}

export interface SkillCourse {
  id: string;
  title: string;
}

export interface SkillEvidence {
  kind: "course" | "assessment";
  id: string;
  title: string;
  status: string;
  score: number | null;
  href: string;
}

export interface SkillRecommendation {
  id: string;
  title: string;
  status: "continue" | "available";
  href: string;
}

export interface LearnerSkillRow {
  id: string;
  name: string;
  description: string | null;
  externalRef: string | null;
  state: "completed_learning" | "in_progress" | "not_started";
  evidence: SkillEvidence[];
  recommendations: SkillRecommendation[];
}

/** Course specs can attach tags at course, objective, item or block level. */
export function collectSkillTagIds(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectSkillTagIds(item, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "skillTagIds" && Array.isArray(child)) {
      for (const id of child) if (typeof id === "string") found.add(id);
    } else {
      collectSkillTagIds(child, found);
    }
  }
  return found;
}

interface AssembleInput {
  tags: SkillTagRow[];
  courses: SkillCourse[];
  courseSkills: Map<string, Set<string>>;
  assessmentSkills: Map<string, Set<string>>;
  work: WorkRow[];
}

export function assembleLearnerSkillRows(input: AssembleInput): LearnerSkillRow[] {
  const { tags, courses, courseSkills, assessmentSkills, work } = input;
  const workCourses = new Map(work.filter((row) => row.kind === "course").map((row) => [row.refId, row]));

  return tags.map((tag) => {
    const evidence: SkillEvidence[] = [];
    for (const row of work) {
      const mapped = row.kind === "course"
        ? courseSkills.get(row.refId)?.has(tag.id)
        : row.kind === "assessment"
          ? assessmentSkills.get(row.refId)?.has(tag.id)
          : false;
      if (!mapped || row.kind === "learning_path") continue;
      evidence.push({ kind: row.kind, id: row.id, title: row.title, status: row.status, score: row.score, href: row.href });
    }

    const completed = work.some((row) => {
      if (!isDone(row)) return false;
      return row.kind === "course"
        ? courseSkills.get(row.refId)?.has(tag.id)
        : row.kind === "assessment" && assessmentSkills.get(row.refId)?.has(tag.id);
    });
    const active = evidence.some((item) => !["completed", "passed", "submitted"].includes(item.status));
    const recommendations = courses
      .filter((course) => courseSkills.get(course.id)?.has(tag.id))
      .filter((course) => {
        const row = workCourses.get(course.id);
        return !row || !isDone(row);
      })
      .map((course) => ({
        id: course.id,
        title: course.title,
        status: workCourses.has(course.id) ? "continue" as const : "available" as const,
        href: `/courses/${course.id}`,
      }))
      .sort((a, b) => (a.status === b.status ? a.title.localeCompare(b.title) : a.status === "continue" ? -1 : 1));

    return {
      id: tag.id,
      name: tag.name,
      description: tag.description,
      externalRef: tag.external_ref,
      state: completed ? "completed_learning" as const : active ? "in_progress" as const : "not_started" as const,
      evidence,
      recommendations,
    };
  }).sort((a, b) => {
    const order = { in_progress: 0, completed_learning: 1, not_started: 2 };
    return order[a.state] - order[b.state] || a.name.localeCompare(b.name);
  });
}

export async function buildLearnerSkillRows(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  orgId: string,
  userId: string
): Promise<LearnerSkillRow[]> {
  const [tagsResult, specsResult, coursesResult, work] = await Promise.all([
    supabase.from("skill_tags").select("id, name, description, external_ref").eq("org_id", orgId).order("name"),
    supabase.from("course_specifications").select("id, spec").eq("org_id", orgId).eq("status", "published"),
    supabase.from("courses").select("id, title").eq("org_id", orgId).eq("status", "published").order("title"),
    buildMyWorkRows(supabase, orgId, userId),
  ]);
  if (tagsResult.error) throw tagsResult.error;
  if (specsResult.error) throw specsResult.error;
  if (coursesResult.error) throw coursesResult.error;

  const specs = specsResult.data ?? [];
  const specSkills = new Map(specs.map((row) => [String(row.id), collectSkillTagIds(row.spec)]));
  const specIds = [...specSkills.keys()];
  const { data: objects, error: objectsError } = specIds.length
    ? await supabase.from("learning_objects").select("id, course_specification_id").eq("org_id", orgId).eq("status", "published").in("course_specification_id", specIds)
    : { data: [], error: null };
  if (objectsError) throw objectsError;

  const objectToSpec = new Map((objects ?? []).map((row) => [String(row.id), String(row.course_specification_id)]));
  const objectIds = [...objectToSpec.keys()];
  const { data: links, error: linksError } = objectIds.length
    ? await supabase.from("lesson_learning_objects").select("lesson_id, learning_object_id").eq("org_id", orgId).in("learning_object_id", objectIds)
    : { data: [], error: null };
  if (linksError) throw linksError;
  const lessonIds = [...new Set((links ?? []).map((row) => String(row.lesson_id)))];
  const { data: lessons, error: lessonsError } = lessonIds.length
    ? await supabase.from("lessons").select("id, module_id").eq("org_id", orgId).in("id", lessonIds)
    : { data: [], error: null };
  if (lessonsError) throw lessonsError;
  const lessonToModule = new Map((lessons ?? []).map((row) => [String(row.id), String(row.module_id)]));
  const moduleIds = [...new Set(lessonToModule.values())];
  const { data: modules, error: modulesError } = moduleIds.length
    ? await supabase.from("modules").select("id, course_id").eq("org_id", orgId).in("id", moduleIds)
    : { data: [], error: null };
  if (modulesError) throw modulesError;
  const moduleToCourse = new Map((modules ?? []).map((row) => [String(row.id), String(row.course_id)]));
  const courseSkills = new Map<string, Set<string>>();
  for (const link of links ?? []) {
    const courseId = moduleToCourse.get(lessonToModule.get(String(link.lesson_id)) ?? "");
    const skillIds = specSkills.get(objectToSpec.get(String(link.learning_object_id)) ?? "");
    if (!courseId || !skillIds) continue;
    const target = courseSkills.get(courseId) ?? new Set<string>();
    for (const skillId of skillIds) target.add(skillId);
    courseSkills.set(courseId, target);
  }

  const assessmentIds = work.filter((row) => row.kind === "assessment").map((row) => row.refId);
  const assessmentSkills = new Map<string, Set<string>>();
  if (assessmentIds.length) {
    const { data: questionLinks, error: questionLinksError } = await admin
      .from("assessment_questions")
      .select("assessment_id, question_id")
      .eq("org_id", orgId)
      .in("assessment_id", assessmentIds);
    if (questionLinksError) throw questionLinksError;
    const questionIds = [...new Set((questionLinks ?? []).map((row) => String(row.question_id)))];
    const { data: questions, error: questionsError } = questionIds.length
      ? await admin.from("question_bank_items").select("id, skill_code").eq("org_id", orgId).in("id", questionIds)
      : { data: [], error: null };
    if (questionsError) throw questionsError;
    const tagsByCode = new Map<string, string>();
    for (const tag of (tagsResult.data ?? []) as SkillTagRow[]) {
      tagsByCode.set(tag.name.trim().toLowerCase(), tag.id);
      if (tag.external_ref) tagsByCode.set(tag.external_ref.trim().toLowerCase(), tag.id);
    }
    const questionSkill = new Map((questions ?? []).flatMap((row) => {
      const code = typeof row.skill_code === "string" ? row.skill_code.trim().toLowerCase() : "";
      const tagId = tagsByCode.get(code);
      return tagId ? [[String(row.id), tagId] as const] : [];
    }));
    for (const link of questionLinks ?? []) {
      const tagId = questionSkill.get(String(link.question_id));
      if (!tagId) continue;
      const assessmentId = String(link.assessment_id);
      const target = assessmentSkills.get(assessmentId) ?? new Set<string>();
      target.add(tagId);
      assessmentSkills.set(assessmentId, target);
    }
  }

  return assembleLearnerSkillRows({
    tags: (tagsResult.data ?? []) as SkillTagRow[],
    courses: (coursesResult.data ?? []) as SkillCourse[],
    courseSkills,
    assessmentSkills,
    work,
  });
}
