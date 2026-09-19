import { z } from "zod";
import { ColorToken, AssetRef } from "./primitives";

/**
 * The layout model.
 *
 * **Widened for Phase 3B (scope decision 2026-08-16).** Phase 3 ships no editor
 * surface that produces canvas layout, but the specification must be able to
 * express it from v1: adding absolute positioning after the interpreter (step 5)
 * and the visual editor (step 6) exist would mean a spec migration plus two
 * rewrites. See MASTER_FEATURE_MATRIX.md reconciliation note 4.
 *
 * Responsive flow remains the *default* and the recommended mode. Canvas is an
 * opt-in, and the accessibility validation gate applies to it just the same —
 * parity should not mean inheriting Storyline's accessibility problems along
 * with its canvas.
 */

/** Flow layout: blocks stack responsively. No coordinates exist. */
export const FlowLayout = z.strictObject({
  mode: z.literal("flow"),
  /** Optional max content width token, e.g. "narrow" | "regular" | "wide". */
  width: z.enum(["narrow", "regular", "wide", "full"]).optional(),
});

export type FlowLayout = z.infer<typeof FlowLayout>;

/**
 * Canvas layout: blocks are absolutely positioned against a design viewport.
 *
 * The design viewport is mandatory — absolute coordinates are meaningless
 * without the frame they were authored against, and it is what allows the
 * runtime to scale rather than clip on a smaller screen.
 */
export const CanvasLayout = z.strictObject({
  mode: z.literal("canvas"),
  /** The frame the author positioned against, in CSS pixels. */
  width: z.number().int().min(320).max(7680),
  height: z.number().int().min(240).max(4320),
  /**
   * How the runtime reconciles the design viewport with the real one.
   * `fit` preserves aspect ratio and letterboxes; `fixed` scrolls.
   */
  scaling: z.enum(["fit", "fill", "fixed"]).default("fit"),
  background: z
    .object({
      color: ColorToken.optional(),
      imageAssetId: AssetRef.optional(),
      fit: z.enum(["cover", "contain", "tile"]).optional(),
    })
    .optional(),
});

export type CanvasLayout = z.infer<typeof CanvasLayout>;

export const PageLayout = z.discriminatedUnion("mode", [FlowLayout, CanvasLayout]);
export type PageLayout = z.infer<typeof PageLayout>;

/**
 * Absolute placement of a block.
 *
 * Only meaningful on a page whose layout mode is `canvas`; `validate.ts`
 * rejects a position on a flow page rather than silently ignoring it, because
 * silently-ignored authoring intent is how content quietly breaks.
 */
export const Position = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().min(0),
  height: z.number().min(0),
  /** Coordinates are design-viewport pixels by default. */
  unit: z.enum(["px", "percent"]).default("px"),
  zIndex: z.number().int().min(-999).max(999).optional(),
  /** Degrees, clockwise. */
  rotation: z.number().min(-360).max(360).optional(),
  opacity: z.number().min(0).max(1).optional(),
  /** Locks the block against editor drag once positioned. */
  locked: z.boolean().optional(),
});

export type Position = z.infer<typeof Position>;

/** Design tokens applied across a course. */
export const Theme = z.strictObject({
  colors: z
    .object({
      primary: ColorToken.optional(),
      accent: ColorToken.optional(),
      background: ColorToken.optional(),
      surface: ColorToken.optional(),
      text: ColorToken.optional(),
      muted: ColorToken.optional(),
    })
    .optional(),
  typography: z
    .object({
      headingFont: z.string().max(120).optional(),
      bodyFont: z.string().max(120).optional(),
      baseSizePx: z.number().int().min(10).max(32).optional(),
      scale: z.number().min(1).max(2).optional(),
    })
    .optional(),
  spacing: z.enum(["compact", "regular", "roomy"]).optional(),
  /** Corner rounding token applied to surfaces and media. */
  radius: z.enum(["none", "small", "medium", "large"]).optional(),
});
