import { errorResponse, successResponse } from "@/lib/api/response";
import { requirePlatformOwner } from "@/lib/auth/platform";
import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { unzipSync, strFromU8 } from "fflate";

const REPOSITORY = process.env.GITHUB_QA_REPOSITORY ?? ""; // "owner/repo"
const WORKFLOW = "orbit-qa.yml";

export async function POST() {
  const access = await requirePlatformOwner();
  const session = await getSessionContext();
  if (!access || !session) return errorResponse("FORBIDDEN", "Platform owner access required.", 403);
  const token = process.env.GITHUB_QA_DISPATCH_TOKEN;
  if (!token || !REPOSITORY) return errorResponse("NOT_CONFIGURED", "The GitHub QA runner is not configured.", 503);
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main" }), cache: "no-store",
  });
  if (!response.ok) return errorResponse("QA_DISPATCH_FAILED", "GitHub could not start the isolated QA run.", 502);
  await createAdminClient().from("activity_log").insert({ org_id: null, actor_id: session.userId, event_type: "platform_admin.qa_run.dispatched", entity_type: "qa_run", metadata: { repository: REPOSITORY, workflow: WORKFLOW }, is_platform_admin_action: true });
  return successResponse({ status: "queued", message: "Orbit QA run queued. GitHub Actions will run the isolated Admin and Learner personas." }, 202);
}

export async function GET(request: Request) {
  const access = await requirePlatformOwner();
  if (!access) return errorResponse("FORBIDDEN", "Platform owner access required.", 403);
  const token = process.env.GITHUB_QA_DISPATCH_TOKEN;
  if (!token) return errorResponse("NOT_CONFIGURED", "The GitHub QA runner is not configured.", 503);
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/runs?per_page=1`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store" });
  if (!response.ok) return errorResponse("QA_STATUS_FAILED", "GitHub QA status is unavailable.", 502);
  const json = await response.json() as { workflow_runs?: Array<{ id: number; status: string; conclusion: string | null; html_url: string }> };
  const run = json.workflow_runs?.[0];
  const status = run?.status === "completed" ? (run.conclusion === "success" ? "completed" : "failed") : run?.status ?? "queued";
  if (!run?.id || status !== "completed") return successResponse({ status, detailsUrl: run?.html_url ?? null });
  const artifacts = await fetch(`https://api.github.com/repos/${REPOSITORY}/actions/runs/${run.id}/artifacts`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store" });
  const artifact = (await artifacts.json() as { artifacts?: Array<{ archive_download_url: string }> }).artifacts?.[0];
  if (!artifact) return successResponse({ status, detailsUrl: run.html_url, report: null });
  const archive = await fetch(artifact.archive_download_url, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` }, cache: "no-store" });
  const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  const jsonName = Object.keys(files).find((name) => name.endsWith(".json"));
  const xlsxName = Object.keys(files).find((name) => name.endsWith(".xlsx"));
  if (new URL(request.url).searchParams.get("download") === "report" && xlsxName) return new Response(files[xlsxName], { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=orbit-qa-report.xlsx" } });
  const report = jsonName ? JSON.parse(strFromU8(files[jsonName])) as { stats?: { expected?: number; skipped?: number; unexpected?: number } } : null;
  return successResponse({ status, detailsUrl: run.html_url, report: report?.stats ? { passed: report.stats.expected ?? 0, failed: report.stats.unexpected ?? 0, blocked: report.stats.skipped ?? 0 } : null });
}
