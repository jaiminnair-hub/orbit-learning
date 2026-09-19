/**
 * COPY — source of truth is lib/scorm/cmi.ts in the main app. Pure,
 * dependency-free TypeScript, duplicated here rather than shared via an
 * npm workspace as the pragmatic MVP choice for content-origin isolation
 * (docs/SCORM_CONTENT_ISOLATION_ARCHITECTURE.md) — keep both copies in
 * sync by hand until a workspace is worth setting up.
 *
 * CMI data-model helpers, shared by the SCORM 1.2 and 2004 adapters.
 *
 * SCORM's two generations disagree about almost every representation —
 * time format, how status is split, how score is expressed — while the
 * database stores one normalised shape. Everything that translates
 * between those two worlds lives here, so the adapter itself stays a
 * state machine and this stays testable without a DOM.
 */

export type ScormVersion = "1.2" | "2004";

/** The six values `scorm_progress.lesson_status` accepts. */
export type LessonStatus =
  | "not attempted"
  | "incomplete"
  | "completed"
  | "passed"
  | "failed"
  | "browsed";

export const TERMINAL_STATUSES: readonly LessonStatus[] = ["completed", "passed", "failed"];

export function isTerminal(status: LessonStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * SCORM 1.2 CMITimespan — `HHHH:MM:SS.SS`, hours unbounded.
 * Returns 0 rather than throwing: a malformed time from third-party
 * content must not take down the session.
 */
export function parseCmiTimespan(value: string): number {
  const m = /^(\d{2,4}):(\d{2}):(\d{2}(?:\.\d{1,2})?)$/.exec(value.trim());
  if (!m) return 0;
  const [, h, min, s] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s);
}

export function formatCmiTimespan(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(4, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/**
 * SCORM 2004 uses an ISO 8601 duration (`PT1H30M5S`). Only the time
 * portion is meaningful for a session, but packages do emit day
 * components, so P…D is handled too. Months and years are deliberately
 * ignored — they have no fixed length and no course session is one.
 */
export function parseIso8601Duration(value: string): number {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    value.trim()
  );
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (
    Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0)
  );
}

export function formatIso8601Duration(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.round((safe % 60) * 100) / 100;
  return `PT${h}H${m}M${s}S`;
}

export function parseSessionTime(version: ScormVersion, value: string): number {
  return version === "1.2" ? parseCmiTimespan(value) : parseIso8601Duration(value);
}

export function formatSessionTime(version: ScormVersion, seconds: number): string {
  return version === "1.2" ? formatCmiTimespan(seconds) : formatIso8601Duration(seconds);
}

const VALID_STATUSES: readonly string[] = [
  "not attempted",
  "incomplete",
  "completed",
  "passed",
  "failed",
  "browsed",
];

export function isLessonStatus(value: string): value is LessonStatus {
  return VALID_STATUSES.includes(value);
}

/**
 * Collapses the two generations' status models into the single column the
 * database has.
 *
 * 1.2 carries one `lesson_status`. 2004 deliberately split it in two:
 * `completion_status` (did they get to the end) and `success_status` (did
 * they pass), which are genuinely independent — a learner can complete a
 * course and fail it. Since one column has to hold the answer, success
 * wins when it is known, because "failed" is the more consequential fact
 * and the one a report must not lose. `browsed` has no 2004 equivalent.
 */
export function normalizeStatus(
  version: ScormVersion,
  cmi: Readonly<Record<string, string>>
): LessonStatus {
  if (version === "1.2") {
    const raw = cmi["cmi.core.lesson_status"] ?? "not attempted";
    return isLessonStatus(raw) ? raw : "not attempted";
  }

  const success = cmi["cmi.success_status"] ?? "unknown";
  if (success === "passed" || success === "failed") return success;

  const completion = cmi["cmi.completion_status"] ?? "unknown";
  if (completion === "completed") return "completed";
  if (completion === "incomplete") return "incomplete";
  return "not attempted";
}

/**
 * Raw score, normalised to a 0–100 number or null.
 *
 * 2004 packages often report only `cmi.score.scaled` (-1…1), so that is
 * used as a fallback and scaled up. A negative scaled score is legal in
 * the spec but meaningless as a percentage, so it clamps at 0.
 */
export function normalizeScore(
  version: ScormVersion,
  cmi: Readonly<Record<string, string>>
): number | null {
  const rawKey = version === "1.2" ? "cmi.core.score.raw" : "cmi.score.raw";
  const raw = cmi[rawKey];
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }

  if (version === "2004") {
    const scaled = cmi["cmi.score.scaled"];
    if (scaled != null && scaled !== "") {
      const n = Number(scaled);
      if (Number.isFinite(n)) return Math.max(0, Math.round(n * 10000) / 100);
    }
  }

  return null;
}
