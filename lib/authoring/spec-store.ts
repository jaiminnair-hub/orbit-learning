import type { SupabaseClient } from "@supabase/supabase-js";
import { validateCourseSpec, type CourseSpecType, type ValidationReport } from "@/lib/spec";
import { specSearchText } from "./spec-text";

/**
 * Shared loading, validation and concurrency handling for the authoring
 * routes, so "validate before write" and "never last-write-wins" are one
 * implementation rather than a convention each route re-honours.
 */

export const SPEC_COLUMNS =
  "id, org_id, title, spec, spec_schema_version, status, version, source_kind, source_asset_id, locale, created_by, created_at, updated_at";

export interface SpecRow {
  id: string;
  org_id: string;
  title: string;
  spec: unknown;
  spec_schema_version: string;
  status: string;
  version: number;
  updated_at: string;
  [key: string]: unknown;
}

/** Loads a live (non-deleted) specification, scoped to the caller's org. */
export async function loadSpec(
  supabase: SupabaseClient,
  id: string,
  orgId: string | null
): Promise<SpecRow | null> {
  const { data, error } = await supabase
    .from("course_specifications")
    .select(SPEC_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error || !data || data.org_id !== orgId) return null;
  return data as SpecRow;
}

export interface ValidationOutcome {
  report: ValidationReport;
  /** Schema-level errors block a write; semantic/accessibility ones are reported but allowed. */
  blocking: boolean;
}

/**
 * Validates a candidate document.
 *
 * Only *schema* errors block saving. Semantic errors (a trigger pointing at a
 * block that does not exist yet) and accessibility warnings are surfaced to
 * the author but must not stop an autosave — a half-built course is
 * legitimately incomplete while it is being built, and refusing to persist it
 * would lose the author's work. The publish gate is where the stricter bar
 * belongs.
 */
export function validateForWrite(candidate: unknown): ValidationOutcome {
  const report = validateCourseSpec(candidate);
  const blocking = report.findings.some((f) => f.kind === "schema" && f.severity === "error");
  return { report, blocking };
}

/** True when the document is clean enough to publish: no errors of any kind. */
export function isPublishable(report: ValidationReport): boolean {
  return !report.findings.some((f) => f.severity === "error");
}

export interface WriteResult {
  row: SpecRow | null;
  conflict: boolean;
  error: string | null;
}

/**
 * Writes a validated document with optimistic concurrency.
 *
 * The `updated_at` the caller read the document at is part of the WHERE
 * clause, so two editors saving from the same base do not silently overwrite
 * one another — the loser gets a 409 and can reload. `updated_at` is
 * maintained by the shared set_updated_at() trigger, so it is a revision
 * token that cannot be forgotten.
 */
export async function writeSpec(
  supabase: SupabaseClient,
  params: { id: string; orgId: string; baseUpdatedAt: string; spec: { meta: { title: string } } & object }
): Promise<WriteResult> {
  const { data, error } = await supabase
    .from("course_specifications")
    .update({
      spec: params.spec,
      title: params.spec.meta.title,
      // Keeps full-text search current with the authored body. Written here
      // rather than derived in SQL because the readable text is buried in a
      // nested block tree — see lib/authoring/spec-text.ts.
      search_text: specSearchText(params.spec as CourseSpecType),
    })
    .eq("id", params.id)
    .eq("org_id", params.orgId)
    .eq("updated_at", params.baseUpdatedAt)
    .select(SPEC_COLUMNS)
    .maybeSingle();

  if (error) return { row: null, conflict: false, error: error.message };
  if (!data) return { row: null, conflict: true, error: null };
  return { row: data as SpecRow, conflict: false, error: null };
}

/** Persists a validation report so authors can see why a publish was refused. */
export async function recordValidationReport(
  supabase: SupabaseClient,
  params: {
    orgId: string;
    specId: string;
    specVersion: number;
    report: ValidationReport;
    userId: string;
    kind?: "schema" | "semantic" | "accessibility" | "publish_readiness";
  }
): Promise<void> {
  const severity = params.report.findings.some((f) => f.severity === "error")
    ? "error"
    : params.report.findings.some((f) => f.severity === "warning")
      ? "warning"
      : "info";

  await supabase.from("spec_validation_reports").insert({
    org_id: params.orgId,
    course_specification_id: params.specId,
    spec_version: params.specVersion,
    kind: params.kind ?? "semantic",
    severity,
    findings: params.report.findings,
  });
}
