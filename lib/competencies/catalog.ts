import { createClient } from "@/lib/supabase/server";
import { buildMyWorkRows, isDone } from "@/lib/lms/my-work";
import type { LearningOption } from "./types";

export async function learningCatalog(orgId: string, userId: string, isAdmin: boolean): Promise<LearningOption[]> {
  const db = await createClient();
  const [courses, paths, work] = await Promise.all([
    db.from("courses").select("id,title,description").eq("org_id",orgId).eq("status","published").order("title"),
    db.from("learning_paths").select("id,title,description").eq("org_id",orgId).eq("status","published").order("title"),
    buildMyWorkRows(db,orgId,userId),
  ]);
  if (courses.error) throw courses.error;
  if (paths.error) throw paths.error;
  const result: LearningOption[] = [];
  for (const [kind, rows, prefix] of [["course",courses.data,"/courses/"],["learning_path",paths.data,"/paths/"]] as const) {
    for (const row of rows ?? []) result.push({id:row.id,kind,title:row.title,description:row.description ?? "",href:`${prefix}${row.id}`,completed:work.some(w=>w.kind===kind && w.refId===row.id && isDone(w))});
  }
  if (isAdmin) {
    const assessments = await db.from("assessments").select("id,title").eq("org_id",orgId).eq("status","published");
    if (assessments.error) throw assessments.error;
    for (const a of assessments.data ?? []) result.push({id:a.id,kind:"assessment",title:a.title,description:"Published assessment",href:`/assessments/${a.id}`,completed:false});
  } else {
    // Assessments are recommended only when already assigned to this learner.
    for (const row of work.filter(w=>w.kind==="assessment")) result.push({id:row.refId,kind:"assessment",title:row.title,description:"Assigned assessment",href:row.href,completed:isDone(row)});
  }
  return result;
}
