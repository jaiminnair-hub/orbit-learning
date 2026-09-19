import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMyWorkRows } from "./my-work";

export type TranscriptKind = "course" | "assessment" | "learning_path" | "certificate";

export interface TranscriptRow {
  kind: TranscriptKind;
  id: string;
  title: string;
  status: string;
  percent: number | null;
  score: number | null;
  dueDate: string | null;
  completedAt: string | null;
  issuedAt: string | null;
  overdue: boolean;
  href: string;
}

export interface TranscriptFilters {
  kind?: TranscriptKind | null;
  status?: "complete" | "incomplete" | "overdue" | null;
  minScore?: number | null;
  maxScore?: number | null;
}

export function filterTranscriptRows(rows: TranscriptRow[], filters: TranscriptFilters): TranscriptRow[] {
  return rows.filter((row) => {
    if (filters.kind && row.kind !== filters.kind) return false;
    if (filters.status === "overdue" && !row.overdue) return false;
    if (filters.status === "complete" && !["completed", "passed", "submitted", "issued"].includes(row.status)) return false;
    if (filters.status === "incomplete" && ["completed", "passed", "submitted", "issued"].includes(row.status)) return false;
    if (filters.minScore != null && (row.score == null || row.score < filters.minScore)) return false;
    if (filters.maxScore != null && (row.score == null || row.score > filters.maxScore)) return false;
    return true;
  });
}

export async function buildTranscriptRows(
  supabase: SupabaseClient,
  orgId: string,
  userId: string
): Promise<TranscriptRow[]> {
  const [work, certificateResult] = await Promise.all([
    buildMyWorkRows(supabase, orgId, userId),
    supabase
      .from("certificates")
      .select("id, title, source_type, score_percent, issued_at")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .order("issued_at", { ascending: false }),
  ]);

  const workRows: TranscriptRow[] = work.map((row) => ({
    kind: row.kind,
    id: row.id,
    title: row.title,
    status: row.status,
    percent: row.percent,
    score: row.score,
    dueDate: row.dueDate,
    completedAt: row.completedAt,
    issuedAt: null,
    overdue: row.overdue,
    href: row.href,
  }));
  const certificateRows: TranscriptRow[] = (certificateResult.data ?? []).map((certificate) => ({
    kind: "certificate",
    id: String(certificate.id),
    title: String(certificate.title),
    status: "issued",
    percent: 100,
    score: certificate.score_percent == null ? null : Number(certificate.score_percent),
    dueDate: null,
    completedAt: String(certificate.issued_at),
    issuedAt: String(certificate.issued_at),
    overdue: false,
    href: `/certificates/${certificate.id}`,
  }));

  return [...workRows, ...certificateRows].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const aDate = a.completedAt ?? a.dueDate ?? a.issuedAt ?? "";
    const bDate = b.completedAt ?? b.dueDate ?? b.issuedAt ?? "";
    return bDate.localeCompare(aDate);
  });
}

export function transcriptSummary(rows: TranscriptRow[]) {
  const workRows = rows.filter((row) => row.kind !== "certificate");
  return {
    total: workRows.length,
    completed: workRows.filter((row) =>
      row.kind === "assessment"
        ? row.status === "passed" || row.status === "submitted"
        : row.status === "completed"
    ).length,
    overdue: workRows.filter((row) => row.overdue).length,
    certificates: rows.filter((row) => row.kind === "certificate").length,
  };
}
