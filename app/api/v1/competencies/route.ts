import { withAuth } from "@/lib/api/with-auth";
import { successResponse, errorResponse } from "@/lib/api/response";
import { foundationFor, callWorkspace, callP2Workspace, CompetencyError } from "@/lib/competencies/foundation";
import { learningCatalog } from "@/lib/competencies/catalog";
import { recommendLearning, recommendTeamLearning, type CompetencyWorkspace } from "@/lib/competencies/types";

export const POST = withAuth(async (request,{session}) => {
  try {
    const raw = await request.text();
    if (raw.length>150000) return errorResponse("TOO_LARGE","Request is too large.",413);
    const {action="read",payload={}} = JSON.parse(raw || "{}");
    if (typeof action!=="string" || !payload || typeof payload!=="object" || Array.isArray(payload)) return errorResponse("INVALID_INPUT","Invalid request.",400);
    const client = await foundationFor(request,session);
    // Both Foundation's role gate and Learning's content RLS apply.
    if (["save_link","approve_link"].includes(action)) {
      const workspace = await callWorkspace(client,"read") as CompetencyWorkspace;
      if (!workspace.isAdmin || !["org_admin","org_owner"].includes(session.role)) throw new CompetencyError("Both Competencies and Learning administrator access are required.",403);
      const link = action==="approve_link" ? workspace.links.find(l=>l.id===payload.id) : null;
      const kind = link?.content_kind ?? payload.contentKind;
      const id = link?.content_id ?? payload.contentId;
      const catalog = await learningCatalog(session.orgId!,session.userId,true);
      if (!catalog.some(c=>c.id===id && c.kind===kind)) throw new CompetencyError("Select published content from this Learning organisation.");
    }
    if (["activate_pack","manager_consent"].includes(action)) return successResponse(await callP2Workspace(client,action,payload));
    if (action==="read") {
      const [base,p2] = await Promise.all([callWorkspace(client,"read"),callP2Workspace(client,"read",payload)]);
      const workspace = {...base,...p2} as CompetencyWorkspace;
      const catalog = await learningCatalog(session.orgId!,session.userId,workspace.isAdmin && ["org_admin","org_owner"].includes(session.role));
      return successResponse({...workspace,catalog,recommendations:recommendLearning(workspace,catalog),teamRecommendations:recommendTeamLearning(workspace,catalog)});
    }
    const data = await callWorkspace(client,action,payload);
    if (action==="export") {
      const workspace = data as CompetencyWorkspace;
      const catalog = await learningCatalog(session.orgId!,session.userId,workspace.isAdmin && ["org_admin","org_owner"].includes(session.role));
      const privacy=await callP2Workspace(client,"privacy");
      return successResponse({...workspace,...privacy,catalog,recommendations:recommendLearning(workspace,catalog),teamRecommendations:[]});
    }
    return successResponse(data);
  } catch(error) {
    if (error instanceof CompetencyError) return errorResponse("COMPETENCIES_UNAVAILABLE",error.message,error.status);
    if (error instanceof SyntaxError) return errorResponse("INVALID_INPUT","Invalid JSON.",400);
    console.error("competencies request failed", error instanceof Error ? error.message : "unknown error");
    return errorResponse("COMPETENCIES_UNAVAILABLE","Could not load competency development. Please try again.",503);
  }
});
