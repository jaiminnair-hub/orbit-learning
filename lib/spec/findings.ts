/**
 * Validation findings.
 *
 * Shaped to be persisted directly as `spec_validation_reports.findings`
 * (PHASE3_DATA_MODEL.md §2.9). The table itself is created in step 4 with the
 * rest of the migrations; this is the contract it will store.
 *
 * Findings are **path-addressed** so the editor can deep-link straight to the
 * offending block rather than telling an author "something is wrong somewhere".
 */

export type FindingSeverity = "error" | "warning" | "info";

/** Mirrors `spec_validation_reports.kind`. */
export type FindingKind = "schema" | "semantic" | "accessibility" | "publish_readiness";

export type Finding = {
  /** Stable machine-readable code. Safe to branch on; messages are not. */
  code: string;
  kind: FindingKind;
  severity: FindingSeverity;
  message: string;
  /** JSON Pointer into the specification, e.g. `/sections/0/pages/1/blocks/2`. */
  path: string;
  /** Denormalised addressing so the editor can navigate without re-parsing. */
  sectionId?: string;
  pageId?: string;
  blockId?: string;
};

export type ValidationReport = {
  /** True when there are no findings of severity `error`. */
  valid: boolean;
  specSchemaVersion: string | null;
  findings: Finding[];
  errorCount: number;
  warningCount: number;
};

export function summarise(findings: Finding[], specSchemaVersion: string | null): ValidationReport {
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  return {
    valid: errorCount === 0,
    specSchemaVersion,
    findings,
    errorCount,
    warningCount,
  };
}

/** Escapes a JSON Pointer path segment per RFC 6901. */
export function pointer(...segments: (string | number)[]): string {
  return (
    "/" +
    segments
      .map((s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1"))
      .join("/")
  );
}
