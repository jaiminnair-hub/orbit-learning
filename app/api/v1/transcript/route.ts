import { withAuth } from "@/lib/api/with-auth";
import { errorResponse, successResponse } from "@/lib/api/response";
import { createClient } from "@/lib/supabase/server";
import {
  buildTranscriptRows,
  filterTranscriptRows,
  transcriptSummary,
  type TranscriptKind,
} from "@/lib/lms/transcript";

const KINDS = new Set(["course", "assessment", "learning_path", "certificate"]);
const STATUSES = new Set(["complete", "incomplete", "overdue"]);

export const GET = withAuth(async (request, { session }) => {
  if (!session.orgId) return errorResponse("NO_ORG", "You must belong to an organization.", 409);
  const url = new URL(request.url);
  const kindValue = url.searchParams.get("kind");
  const statusValue = url.searchParams.get("status");
  const minScoreValue = url.searchParams.get("minScore");
  const maxScoreValue = url.searchParams.get("maxScore");
  if (kindValue && !KINDS.has(kindValue)) return errorResponse("INVALID_KIND", "Unknown transcript type.", 400);
  if (statusValue && !STATUSES.has(statusValue)) return errorResponse("INVALID_STATUS", "Unknown transcript status.", 400);
  const minScore = minScoreValue === null ? null : Number(minScoreValue);
  const maxScore = maxScoreValue === null ? null : Number(maxScoreValue);
  if ((minScore != null && (!Number.isFinite(minScore) || minScore < 0 || minScore > 100)) ||
      (maxScore != null && (!Number.isFinite(maxScore) || maxScore < 0 || maxScore > 100))) {
    return errorResponse("INVALID_SCORE", "Score filters must be between 0 and 100.", 400);
  }

  const rows = await buildTranscriptRows(await createClient(), session.orgId, session.userId);
  const filtered = filterTranscriptRows(rows, {
    kind: (kindValue as TranscriptKind | null) ?? null,
    status: (statusValue as "complete" | "incomplete" | "overdue" | null) ?? null,
    minScore,
    maxScore,
  });
  return successResponse({ rows: filtered, summary: transcriptSummary(rows), totalBeforeFilters: rows.length });
});
