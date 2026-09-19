"use client";

import type { Animation, CanvasLayout, LayerType as Layer, PageLayout, PageType as Page, TimelineTrack } from "@/lib/spec";
import type { Timeline } from "@/lib/spec";
import { BLOCK_LABELS, createBlock, richText, specId } from "@/lib/authoring/block-factory";
import { AssetSelectField, CheckboxField, Field, NumberField, SelectField, TextField, fieldStyle, labelStyle } from "./fields";
import { boxStyle as box, dangerButtonStyle as removeBtn, dangerColor, mutedTextStyle } from "./theme";

/**
 * Layers, timeline cue points, and per-block animation — the Storyline
 * surfaces the block inspector has nowhere else to put.
 *
 * A layer belongs to a block (`blocks[].layers[]`) rather than to the page,
 * which is why it is edited from the selected block. Cue points belong to the
 * page timeline, which is why they are not.
 *
 * Entrance/exit/emphasis animation (Phase 3B, Track 1 step 2) is authored the
 * same way: per block, via `BlockTimelineTrackEditor` below, since a
 * `TimelineTrack` is keyed by `blockId`. Motion-path animation stays out of
 * this editor on purpose — its coordinates only mean something on a
 * canvas-layout page (Track 2), which flow pages don't have.
 */

export function LayersEditor({
  layers,
  onChange,
}: {
  layers: Layer[];
  onChange: (next: Layer[]) => void;
}) {
  return (
    <div>
      <h4 style={{ margin: "0 0 8px", fontSize: ".85rem" }}>Layers on this block</h4>
      <p style={{ ...mutedTextStyle, fontSize: ".75rem", marginTop: 0 }}>
        Overlays shown and hidden by triggers — feedback panels, hints, detail popups.
      </p>

      {layers.length === 0 && <p style={{ ...mutedTextStyle, fontSize: ".8rem" }}>No layers yet.</p>}

      {layers.map((layer, i) => (
        <div key={layer.id} style={box}>
          <TextField
            label={`Layer ${i + 1} name`}
            value={layer.name ?? ""}
            onChange={(name) => onChange(replaceAt(layers, i, { ...layer, name: name || undefined }))}
          />
          <CheckboxField
            label="Modal (dims the page behind it)"
            checked={layer.modal ?? false}
            onChange={(modal) => onChange(replaceAt(layers, i, { ...layer, modal: modal || undefined }))}
          />
          <CheckboxField
            label="Learner can dismiss it"
            checked={layer.dismissible ?? false}
            onChange={(dismissible) => onChange(replaceAt(layers, i, { ...layer, dismissible: dismissible || undefined }))}
          />

          <span style={labelStyle}>Contents</span>
          {layer.blocks.map((lb, bi) => (
            <div key={lb.id} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ flex: 1, fontSize: ".78rem" }}>
                {BLOCK_LABELS[lb.type] ?? lb.type}
                <code style={{ color: "var(--color-muted-foreground)", marginLeft: 6 }}>{lb.id}</code>
              </span>
              {layer.blocks.length > 1 && (
                <button
                  type="button"
                  style={{ color: dangerColor, fontSize: ".75rem" }}
                  onClick={() => onChange(replaceAt(layers, i, { ...layer, blocks: removeAt(layer.blocks, bi) }))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {(["heading", "text", "statement"] as const).map((t) => (
              <button
                key={t}
                type="button"
                style={{ fontSize: ".72rem" }}
                onClick={() => onChange(replaceAt(layers, i, { ...layer, blocks: [...layer.blocks, createBlock(t)] }))}
              >
                + {BLOCK_LABELS[t]}
              </button>
            ))}
          </div>

          <button type="button" style={removeBtn} onClick={() => onChange(removeAt(layers, i))}>
            Remove layer
          </button>
        </div>
      ))}

      <button
        type="button"
        style={{ fontSize: ".75rem", marginTop: 8 }}
        onClick={() =>
          onChange([
            ...layers,
            {
              id: specId("layer"),
              name: `Layer ${layers.length + 1}`,
              dismissible: true,
              // A layer must hold at least one block to satisfy the schema, so
              // it is created with real content rather than empty.
              blocks: [{ id: specId("text"), type: "text", content: richText("Layer content.") }],
            },
          ])
        }
      >
        + Layer
      </button>
    </div>
  );
}

export function TimelineEditor({
  page,
  onChange,
}: {
  page: Page;
  onChange: (next: Timeline | undefined) => void;
}) {
  const timeline = page.timeline;

  if (!timeline) {
    return (
      <div>
        <h4 style={{ margin: "12px 0 8px", fontSize: ".85rem" }}>Timeline</h4>
        <p style={{ ...mutedTextStyle, fontSize: ".8rem", marginTop: 0 }}>
          Add a timeline to reveal blocks on a schedule and give triggers cue points to fire from.
        </p>
        <button type="button" style={{ fontSize: ".75rem" }} onClick={() => onChange({ durationMs: 10_000, autoplay: true, cuePoints: [] })}>
          + Timeline
        </button>
      </div>
    );
  }

  const cuePoints = timeline.cuePoints ?? [];

  return (
    <div>
      <h4 style={{ margin: "12px 0 8px", fontSize: ".85rem" }}>Timeline</h4>

      <NumberField
        label="Duration (seconds)"
        value={Math.round(timeline.durationMs / 1000)}
        min={0}
        onChange={(seconds) => onChange({ ...timeline, durationMs: Math.max(0, Math.round(seconds)) * 1000 })}
      />
      <CheckboxField
        label="Start automatically on page entry"
        checked={timeline.autoplay ?? false}
        onChange={(autoplay) => onChange({ ...timeline, autoplay: autoplay || undefined })}
      />

      <span style={labelStyle}>Cue points</span>
      {cuePoints.length === 0 && <p style={{ ...mutedTextStyle, fontSize: ".8rem" }}>None yet.</p>}

      {cuePoints.map((cue, i) => (
        <div key={cue.id} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
          <input
            style={{ ...fieldStyle, flex: 2 }}
            value={cue.name ?? ""}
            placeholder="Cue name"
            onChange={(e) => onChange({ ...timeline, cuePoints: replaceAt(cuePoints, i, { ...cue, name: e.target.value || undefined }) })}
          />
          <input
            style={{ ...fieldStyle, flex: 1 }}
            type="number"
            min={0}
            value={cue.atMs / 1000}
            onChange={(e) =>
              onChange({ ...timeline, cuePoints: replaceAt(cuePoints, i, { ...cue, atMs: Math.max(0, Number(e.target.value)) * 1000 }) })
            }
          />
          <span style={{ ...mutedTextStyle, fontSize: ".75rem" }}>s</span>
          <button
            type="button"
            style={{ color: dangerColor, fontSize: ".75rem" }}
            onClick={() => onChange({ ...timeline, cuePoints: removeAt(cuePoints, i) })}
          >
            ✕
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button
          type="button"
          style={{ fontSize: ".75rem" }}
          onClick={() =>
            onChange({
              ...timeline,
              cuePoints: [...cuePoints, { id: specId("cue"), name: `Cue ${cuePoints.length + 1}`, atMs: Math.min(timeline.durationMs, (cuePoints.length + 1) * 2000) }],
            })
          }
        >
          + Cue point
        </button>
        <button type="button" style={{ fontSize: ".75rem", color: dangerColor }} onClick={() => onChange(undefined)}>
          Remove timeline
        </button>
      </div>
    </div>
  );
}

const DEFAULT_CANVAS: CanvasLayout = { mode: "canvas", width: 1280, height: 720, scaling: "fit" };
const CANVAS_SCALING = ["fit", "fill", "fixed"] as const;

/**
 * A page's layout mode — Phase 3B, Track 2 step 1. Flow (the default, no
 * `layout` at all) stacks blocks responsively; canvas positions them
 * absolutely against a fixed design viewport (`CanvasLayout`), which is what
 * `BlockTimelineTrackEditor`'s sibling, the block inspector's Position
 * section, then places blocks onto.
 */
export function PageLayoutEditor({ page, onChange }: { page: Page; onChange: (next: PageLayout | undefined) => void }) {
  const layout = page.layout;
  const isCanvas = layout?.mode === "canvas";

  return (
    <div>
      <h4 style={{ margin: "12px 0 8px", fontSize: ".85rem" }}>Layout</h4>
      <CheckboxField
        label="Free-form canvas (absolute positioning) instead of flow"
        checked={isCanvas}
        onChange={(on) => onChange(on ? DEFAULT_CANVAS : undefined)}
      />

      {isCanvas && (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <NumberField label="Design width (px)" value={layout.width} min={320} max={7680} onChange={(width) => onChange({ ...layout, width: Math.round(width) })} />
            <NumberField label="Design height (px)" value={layout.height} min={240} max={4320} onChange={(height) => onChange({ ...layout, height: Math.round(height) })} />
          </div>
          <SelectField
            label="Scaling"
            value={layout.scaling ?? "fit"}
            options={CANVAS_SCALING}
            onChange={(scaling) => onChange({ ...layout, scaling })}
          />
          <p style={{ ...mutedTextStyle, fontSize: ".7rem", marginTop: 2 }}>
            Fit keeps the design&apos;s proportions and shrinks to the screen. Fill stretches to the screen&apos;s own shape. Fixed uses exact pixels and scrolls instead of shrinking.
          </p>

          <span style={labelStyle}>Background</span>
          <TextField
            label="Colour (hex or theme token)"
            value={layout.background?.color ?? ""}
            onChange={(color) => onChange({ ...layout, background: { ...layout.background, color: color || undefined } })}
          />
          <AssetSelectField
            label="Image"
            value={layout.background?.imageAssetId}
            onChange={(imageAssetId) => onChange({ ...layout, background: { ...layout.background, imageAssetId } })}
          />
          {layout.background?.imageAssetId && (
            <SelectField
              label="Image fit"
              value={layout.background?.fit ?? "cover"}
              options={["cover", "contain", "tile"] as const}
              onChange={(fit) => onChange({ ...layout, background: { ...layout.background, fit } })}
            />
          )}
        </>
      )}
    </div>
  );
}

const ANIMATION_KINDS = ["entrance", "exit", "emphasis"] as const;
const ENTRANCE_PRESETS = ["fade", "wipe", "slideFromLeft", "slideFromRight", "slideFromTop", "slideFromBottom", "zoomIn", "grow", "spin"] as const;
const EXIT_PRESETS = ["fade", "wipe", "slideToLeft", "slideToRight", "slideToTop", "slideToBottom", "zoomOut", "shrink", "spin"] as const;
const EMPHASIS_PRESETS = ["pulse", "shake", "flash", "bounce", "colorShift"] as const;
const EASINGS = ["linear", "easeIn", "easeOut", "easeInOut", "spring", "bounce"] as const;

/** Everything but `MotionAnimation` — that variant needs a canvas-layout page (Track 2), which this editor never targets. */
type PresetAnimation = Exclude<Animation, { kind: "motion" }>;

function defaultAnimation(kind: (typeof ANIMATION_KINDS)[number]): PresetAnimation {
  const base = { id: specId("anim"), startMs: 0, durationMs: 500 };
  switch (kind) {
    case "entrance":
      return { ...base, kind, preset: "fade" };
    case "exit":
      return { ...base, kind, preset: "fade" };
    case "emphasis":
      return { ...base, kind, preset: "pulse" };
  }
}

/** One block's appear/disappear schedule and animations on the page timeline. */
export function BlockTimelineTrackEditor({
  timeline,
  blockId,
  onChange,
}: {
  timeline: Timeline;
  blockId: string;
  onChange: (next: Timeline) => void;
}) {
  const tracks = timeline.tracks ?? [];
  const trackIndex = tracks.findIndex((t) => t.blockId === blockId);
  const track: TimelineTrack = trackIndex >= 0 ? tracks[trackIndex] : { blockId };
  const animations = track.animations ?? [];

  function save(next: TimelineTrack) {
    const isEmpty = next.appearAtMs === undefined && next.disappearAtMs === undefined && !next.animations?.length;
    const nextTracks = isEmpty
      ? trackIndex >= 0
        ? removeAt(tracks, trackIndex)
        : tracks
      : trackIndex >= 0
        ? replaceAt(tracks, trackIndex, next)
        : [...tracks, next];
    onChange({ ...timeline, tracks: nextTracks.length ? nextTracks : undefined });
  }

  return (
    <div>
      <h4 style={{ margin: "12px 0 8px", fontSize: ".85rem" }}>Timeline: this block</h4>
      <p style={{ ...mutedTextStyle, fontSize: ".75rem", marginTop: 0 }}>
        When this block appears and disappears as the page timeline plays, and how it animates in, out, or draws attention to itself.
      </p>

      <CheckboxField
        label="Hidden until a scheduled time"
        checked={track.appearAtMs !== undefined}
        onChange={(on) => save({ ...track, appearAtMs: on ? 0 : undefined })}
      />
      {track.appearAtMs !== undefined && (
        <NumberField
          label="Appears at (seconds)"
          value={track.appearAtMs / 1000}
          min={0}
          onChange={(s) => save({ ...track, appearAtMs: Math.max(0, Math.round(s * 1000)) })}
        />
      )}

      <CheckboxField
        label="Disappears at a scheduled time"
        checked={track.disappearAtMs !== undefined}
        onChange={(on) => save({ ...track, disappearAtMs: on ? Math.max(1000, (track.appearAtMs ?? 0) + 1000) : undefined })}
      />
      {track.disappearAtMs !== undefined && (
        <NumberField
          label="Disappears at (seconds)"
          value={track.disappearAtMs / 1000}
          min={0}
          onChange={(s) => save({ ...track, disappearAtMs: Math.max(0, Math.round(s * 1000)) })}
        />
      )}

      <span style={labelStyle}>Animations</span>
      {animations.length === 0 && <p style={{ ...mutedTextStyle, fontSize: ".8rem" }}>None yet.</p>}
      {animations.map((animation, i) =>
        animation.kind === "motion" ? (
          <p key={animation.id} style={{ ...mutedTextStyle, fontSize: ".75rem" }}>
            Motion animation (needs a canvas-layout page) — not editable here.
          </p>
        ) : (
          <AnimationEditor
            key={animation.id}
            animation={animation}
            onChange={(next) => save({ ...track, animations: replaceAt(animations, i, next) })}
            onRemove={() => save({ ...track, animations: removeAt(animations, i) })}
          />
        )
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {ANIMATION_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            style={{ fontSize: ".72rem" }}
            onClick={() => save({ ...track, animations: [...animations, defaultAnimation(kind)] })}
          >
            + {kind}
          </button>
        ))}
      </div>
    </div>
  );
}

function AnimationEditor({
  animation,
  onChange,
  onRemove,
}: {
  animation: PresetAnimation;
  onChange: (next: PresetAnimation) => void;
  onRemove: () => void;
}) {
  const presets = animation.kind === "entrance" ? ENTRANCE_PRESETS : animation.kind === "exit" ? EXIT_PRESETS : EMPHASIS_PRESETS;

  return (
    <div style={box}>
      <SelectField label="Kind" value={animation.kind} options={ANIMATION_KINDS} onChange={(kind) => onChange(defaultAnimation(kind))} />

      <SelectField
        label="Preset"
        value={animation.preset}
        options={presets}
        onChange={(preset) => onChange({ ...animation, preset } as PresetAnimation)}
      />

      <NumberField
        label="Starts at (seconds)"
        value={animation.startMs / 1000}
        min={0}
        onChange={(s) => onChange({ ...animation, startMs: Math.max(0, Math.round(s * 1000)) })}
      />
      <NumberField
        label="Duration (seconds)"
        value={animation.durationMs / 1000}
        min={0}
        onChange={(s) => onChange({ ...animation, durationMs: Math.max(0, Math.round(s * 1000)) })}
      />
      <SelectField
        label="Easing"
        value={animation.easing ?? "easeInOut"}
        options={EASINGS}
        onChange={(easing) => onChange({ ...animation, easing })}
      />

      <Field label="Repeat">
        <select
          style={fieldStyle}
          value={animation.repeat === undefined ? "once" : animation.repeat === 0 ? "loop" : "count"}
          onChange={(e) => {
            const mode = e.target.value;
            if (mode === "once") onChange({ ...animation, repeat: undefined });
            else if (mode === "loop") onChange({ ...animation, repeat: 0 });
            else onChange({ ...animation, repeat: 2 });
          }}
        >
          <option value="once">Once</option>
          <option value="loop">Loop until the page changes</option>
          <option value="count">Repeat a set number of times</option>
        </select>
      </Field>
      {animation.repeat !== undefined && animation.repeat !== 0 && (
        <NumberField
          label="Repeat count"
          value={animation.repeat}
          min={1}
          max={999}
          onChange={(n) => onChange({ ...animation, repeat: Math.max(1, Math.round(n)) })}
        />
      )}

      <button type="button" style={removeBtn} onClick={onRemove}>
        Remove animation
      </button>
    </div>
  );
}

function replaceAt<T>(arr: T[], index: number, value: T): T[] {
  const next = [...arr];
  next[index] = value;
  return next;
}

function removeAt<T>(arr: T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}
