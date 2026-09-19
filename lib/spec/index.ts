/**
 * The course specification — Phase 3's central contract.
 *
 * The AI writes it, the editor edits it, the runtime interprets it, and every
 * publish target renders from it. Import from here rather than from the
 * individual modules, so the surface stays deliberate.
 */

export { SPEC_SCHEMA_VERSION, SUPPORTED_SPEC_SCHEMA_VERSIONS, isSupportedSpecSchemaVersion } from "./version";

export { CourseSpec, Page, Section, CourseMeta, LearningObjective } from "./course-spec";
export type { CourseSpec as CourseSpecType, Page as PageType, Section as SectionType } from "./course-spec";

export { Block, LeafBlock, Layer, BLOCK_TYPES } from "./blocks";
export type { Block as BlockType, LeafBlock as LeafBlockType, Layer as LayerType } from "./blocks";

export { Variable, Trigger, Action, Condition, Comparison, BlockState, TriggerEvent } from "./interactions";
export { PageLayout, Position, Theme, FlowLayout, CanvasLayout } from "./layout";
export { Timeline, Animation, MotionPath, CuePoint, TimelineTrack } from "./timeline";
export { AssessmentItem } from "./items";
export { RichText, Accessibility, Provenance, SpecId } from "./primitives";

export { validateCourseSpec, isValidCourseSpec } from "./validate";
export { summarise, pointer } from "./findings";
export type { Finding, FindingKind, FindingSeverity, ValidationReport } from "./findings";

export { courseSpecJsonSchema, generationSchemas, generationZodSchemas } from "./json-schema";
export type { JsonSchema, GenerationSchemaName } from "./json-schema";
