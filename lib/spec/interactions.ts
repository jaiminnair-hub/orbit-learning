import { z } from "zod";
import { PlainText, RichText, SpecId } from "./primitives";

/**
 * States, variables, triggers and conditions — Storyline's interaction logic,
 * which is the part that actually separates interactive e-learning from a
 * document.
 *
 * Everything here is a **closed declarative set**. There is no expression
 * language, no formula field, and no script hook. A trigger is data the runtime
 * interprets; it is never something the runtime executes. That is what makes
 * "an injected instruction cannot produce a valid spec that does something
 * else" (PHASE3_AI_ARCHITECTURE.md §7) structurally true.
 */

export const VariableType = z.enum(["number", "text", "boolean"]);

export const Variable = z.strictObject({
  id: SpecId,
  name: PlainText,
  type: VariableType,
  scope: z.enum(["course", "page"]).default("course"),
  initial: z.union([z.number(), z.string().max(2000), z.boolean()]).optional(),
  /** Exposed for display in text blocks via a reference, not interpolation. */
  description: PlainText.optional(),
});

export type Variable = z.infer<typeof Variable>;

/**
 * A named visual/behavioural state of a block.
 *
 * `normal` is implicit — a block with no states is always in `normal`.
 */
export const BlockState = z.strictObject({
  id: SpecId,
  name: z.enum(["normal", "hover", "down", "visited", "selected", "disabled", "correct", "incorrect", "custom"]),
  /** Required when `name` is `custom`; ignored otherwise. */
  customName: PlainText.optional(),
  /** State-specific overrides. Deliberately narrow — not a free style bag. */
  appearance: z
    .object({
      hidden: z.boolean().optional(),
      opacity: z.number().min(0).max(1).optional(),
      scale: z.number().min(0).max(10).optional(),
      textOverride: RichText.optional(),
      imageAssetId: z.uuid().optional(),
    })
    .optional(),
});

/** Events a trigger can fire on. */
export const TriggerEvent = z.enum([
  "pageEnter",
  "pageExit",
  "click",
  "doubleClick",
  "hover",
  "hoverOut",
  "focus",
  "blur",
  "mediaComplete",
  "mediaStart",
  "timelineCue",
  "timelineComplete",
  "variableChange",
  "blockComplete",
  "answerSubmitted",
  "layerShown",
  "layerHidden",
]);

export const ComparisonOperator = z.enum([
  "equals",
  "notEquals",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "contains",
  "startsWith",
  "isEmpty",
  "isNotEmpty",
]);

/** A single testable fact. */
export const Comparison = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("variable"),
    variableId: SpecId,
    operator: ComparisonOperator,
    value: z.union([z.number(), z.string().max(2000), z.boolean()]).optional(),
  }),
  z.strictObject({ kind: z.literal("pageVisited"), pageId: SpecId }),
  z.strictObject({ kind: z.literal("blockCompleted"), blockId: SpecId }),
  z.strictObject({ kind: z.literal("blockState"), blockId: SpecId, stateId: SpecId }),
  z.strictObject({ kind: z.literal("layerVisible"), layerId: SpecId }),
  z.strictObject({ kind: z.literal("answerCorrect"), blockId: SpecId }),
]);

/**
 * Condition groups are **flat, not recursive**.
 *
 * Two reasons, and they agree: Storyline's own condition editor is a flat
 * AND/OR list, so nothing authors expect is lost; and recursive JSON Schema is
 * unevenly supported across providers' structured-output modes, which would
 * make the AI half of this system harder for no authoring gain.
 */
export const Condition = z.strictObject({
  all: z.array(Comparison).max(20).optional(),
  any: z.array(Comparison).max(20).optional(),
  none: z.array(Comparison).max(20).optional(),
});

export const NavigationTarget = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("page"), pageId: SpecId }),
  z.strictObject({ kind: z.literal("next") }),
  z.strictObject({ kind: z.literal("previous") }),
  z.strictObject({ kind: z.literal("firstPage") }),
  z.strictObject({ kind: z.literal("exit") }),
]);

/** The closed set of things a trigger may do. */
export const Action = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("setVariable"),
    variableId: SpecId,
    operation: z.enum(["set", "add", "subtract", "multiply", "divide", "toggle", "append"]),
    value: z.union([z.number(), z.string().max(2000), z.boolean()]).optional(),
    /** Take the value from another variable instead of a literal. */
    fromVariableId: SpecId.optional(),
  }),
  z.strictObject({ kind: z.literal("showBlock"), blockId: SpecId }),
  z.strictObject({ kind: z.literal("hideBlock"), blockId: SpecId }),
  z.strictObject({ kind: z.literal("setState"), blockId: SpecId, stateId: SpecId }),
  z.strictObject({ kind: z.literal("showLayer"), layerId: SpecId }),
  z.strictObject({ kind: z.literal("hideLayer"), layerId: SpecId }),
  z.strictObject({ kind: z.literal("navigate"), target: NavigationTarget }),
  z.strictObject({ kind: z.literal("playMedia"), blockId: SpecId }),
  z.strictObject({ kind: z.literal("pauseMedia"), blockId: SpecId }),
  z.strictObject({ kind: z.literal("seekMedia"), blockId: SpecId, toMs: z.number().int().min(0) }),
  z.strictObject({ kind: z.literal("playTimeline") }),
  z.strictObject({ kind: z.literal("pauseTimeline") }),
  z.strictObject({ kind: z.literal("seekTimeline"), toMs: z.number().int().min(0) }),
  z.strictObject({ kind: z.literal("markComplete"), blockId: SpecId.optional() }),
  z.strictObject({ kind: z.literal("submitAnswer"), blockId: SpecId }),
  z.strictObject({ kind: z.literal("resetBlock"), blockId: SpecId }),
  /** Emits an xAPI statement with a verb from a controlled vocabulary. */
  z.strictObject({
    kind: z.literal("emitStatement"),
    verb: z.enum(["experienced", "interacted", "answered", "completed", "passed", "failed", "progressed"]),
    objectId: SpecId.optional(),
  }),
]);

export type Action = z.infer<typeof Action>;

export const Trigger = z.strictObject({
  id: SpecId,
  when: TriggerEvent,
  /**
   * The block, layer or cue point the event originates from. Omitted for
   * page-level events such as `pageEnter`.
   */
  onId: SpecId.optional(),
  condition: Condition.optional(),
  actions: z.array(Action).min(1).max(20),
  /** Fires once per session rather than on every occurrence. */
  once: z.boolean().optional(),
});

export type Trigger = z.infer<typeof Trigger>;
