/**
 * The specification schema version.
 *
 * Stored on every `course_specifications` row (`spec_schema_version`) so the
 * document and the schema it was written against never drift apart.
 *
 * Evolution rules, per PHASE3_TECHNICAL_ARCHITECTURE.md §2:
 *
 * - **Additive changes bump the minor version.** Optional fields, new enum
 *   members, new block types. Older documents remain valid.
 * - **Breaking changes bump the major version and require an explicit
 *   migration.** Never re-interpret an existing field's meaning in place — a
 *   renderer must be able to trust what a version claims.
 * - Renderers declare the versions they support and refuse the rest, rather
 *   than best-effort rendering something they do not understand.
 */
export const SPEC_SCHEMA_VERSION = "1.0.0";

/** Versions this build can read. */
export const SUPPORTED_SPEC_SCHEMA_VERSIONS = ["1.0.0"] as const;

export type SupportedSpecSchemaVersion = (typeof SUPPORTED_SPEC_SCHEMA_VERSIONS)[number];

export function isSupportedSpecSchemaVersion(version: string): version is SupportedSpecSchemaVersion {
  return (SUPPORTED_SPEC_SCHEMA_VERSIONS as readonly string[]).includes(version);
}
