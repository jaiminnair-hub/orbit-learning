import type { SpecId } from "@/lib/spec";

/**
 * Runtime state and effects — the interpreter's in-memory model.
 *
 * Persisted shape is deliberately narrower than this: `course_runtime_state`
 * (Phase 3 step 4) has only `variables jsonb` and `block_states jsonb`
 * alongside `current_page_id`/`completed_at`, so everything here beyond
 * `variables` is folded into one `block_states` blob at the persistence
 * boundary (see `toPersisted`/`fromPersisted`) rather than driving a schema
 * change for what is, to the database, opaque interpreter state.
 */

export type VariableValue = string | number | boolean;

export interface QuizAttemptResult {
  answers: Record<string, unknown>;
  scorePercent: number;
  passed: boolean;
  submittedAt: string;
}

export interface RuntimeState {
  currentPageId: SpecId | null;
  variables: Record<string, VariableValue>;
  /** blockId -> the BlockState.id currently applied (absent = implicit "normal"). */
  blockCurrentStateId: Record<string, string>;
  /** blockId -> visibility override. Absent means "use the block's own initiallyHidden default". */
  visibleBlocks: Record<string, boolean>;
  /** layerId -> visible. Absent means hidden (layers start closed). */
  visibleLayers: Record<string, boolean>;
  visitedPages: string[];
  completedBlocks: string[];
  quizAttempts: Record<string, QuizAttemptResult>;
  /** Set by a `markComplete` action with no blockId — the `manual` completion rule's signal. */
  manuallyCompleted: boolean;
  completedAt: string | null;
}

export type XapiVerb =
  | "initialized"
  | "terminated"
  | "progressed"
  | "experienced"
  | "answered"
  | "completed"
  | "passed"
  | "failed"
  | "interacted";

export interface XapiEffect {
  verb: XapiVerb;
  /** The block or page id the statement is about, if any. */
  objectId?: string;
  result?: {
    success?: boolean;
    completion?: boolean;
    scorePercent?: number;
    response?: string;
  };
}

export interface RuntimeEffects {
  navigatedTo?: SpecId;
  exited?: boolean;
  courseCompleted?: boolean;
  /** Set by a playTimeline/pauseTimeline action — the player's own local, unpersisted clock reacts to this. */
  timelineControl?: "play" | "pause";
  xapi: XapiEffect[];
}

export function emptyEffects(): RuntimeEffects {
  return { xapi: [] };
}

/** The two JSONB columns `course_runtime_state` actually has, plus the two scalar ones. */
export interface PersistedRuntimeRow {
  current_page_id: string | null;
  variables: unknown;
  block_states: unknown;
  completed_at: string | null;
}

interface BlockStatesBlob {
  blockCurrentStateId: Record<string, string>;
  visibleBlocks: Record<string, boolean>;
  visibleLayers: Record<string, boolean>;
  visitedPages: string[];
  completedBlocks: string[];
  quizAttempts: Record<string, QuizAttemptResult>;
  manuallyCompleted: boolean;
}

export function toPersisted(state: RuntimeState): {
  current_page_id: string | null;
  variables: Record<string, VariableValue>;
  block_states: BlockStatesBlob;
} {
  return {
    current_page_id: state.currentPageId,
    variables: state.variables,
    block_states: {
      blockCurrentStateId: state.blockCurrentStateId,
      visibleBlocks: state.visibleBlocks,
      visibleLayers: state.visibleLayers,
      visitedPages: state.visitedPages,
      completedBlocks: state.completedBlocks,
      quizAttempts: state.quizAttempts,
      manuallyCompleted: state.manuallyCompleted,
    },
  };
}

export function fromPersisted(row: PersistedRuntimeRow): RuntimeState {
  const blob = (row.block_states && typeof row.block_states === "object" ? row.block_states : {}) as Partial<BlockStatesBlob>;
  const variables = (row.variables && typeof row.variables === "object" ? row.variables : {}) as Record<string, VariableValue>;
  return {
    currentPageId: row.current_page_id,
    variables,
    blockCurrentStateId: blob.blockCurrentStateId ?? {},
    visibleBlocks: blob.visibleBlocks ?? {},
    visibleLayers: blob.visibleLayers ?? {},
    visitedPages: blob.visitedPages ?? [],
    completedBlocks: blob.completedBlocks ?? [],
    quizAttempts: blob.quizAttempts ?? {},
    manuallyCompleted: blob.manuallyCompleted ?? false,
    completedAt: row.completed_at,
  };
}
