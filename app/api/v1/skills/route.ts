import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { buildLearnerSkillRows } from "@/lib/lms/learner-skills";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const GET = withAuth(async (_request, { session }) => {
  if (!session.orgId) return errorResponse("NO_ORG", "You must belong to an organization.", 409);
  try {
    const skills = await buildLearnerSkillRows(await createClient(), createAdminClient(), session.orgId, session.userId);
    return successResponse({
      skills,
      summary: {
        total: skills.length,
        completedLearning: skills.filter((skill) => skill.state === "completed_learning").length,
        inProgress: skills.filter((skill) => skill.state === "in_progress").length,
        recommendations: skills.reduce((total, skill) => total + skill.recommendations.length, 0),
      },
    });
  } catch (error) {
    return errorResponse("SKILLS_UNAVAILABLE", error instanceof Error ? error.message : "Could not load skills.", 500);
  }
});
