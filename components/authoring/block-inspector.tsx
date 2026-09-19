"use client";

import type { LeafBlockType as LeafBlock } from "@/lib/spec";
import { BLOCK_LABELS, richText, specId } from "@/lib/authoring/block-factory";
import {
  AssetSelectField,
  CheckboxField,
  Field,
  ItemListControls,
  NumberField,
  RichTextField,
  SelectField,
  TextField,
  fieldStyle,
  labelStyle,
} from "./fields";
import { boxStyle as subBox, dangerColor, mutedTextStyle } from "./theme";

/**
 * Property editors for the closed block set.
 *
 * Every branch edits the block's real schema fields — there is no generic
 * "edit the JSON" escape hatch, because an editor that falls back to raw JSON
 * for its harder types is one that never finishes them. The asset-backed
 * types edit everything *except* the asset id, which the media picker owns.
 */

type Update = (next: LeafBlock) => void;

export function BlockInspector({
  block,
  onChange,
  isCanvas = false,
}: {
  block: LeafBlock;
  onChange: Update;
  /** Whether this block's page is in canvas layout (Phase 3B, Track 2 step 1) — gates the Position section below. */
  isCanvas?: boolean;
}) {
  return (
    <div>
      <h3 style={{ margin: "0 0 4px", fontSize: ".95rem" }}>{BLOCK_LABELS[block.type] ?? block.type}</h3>
      <code style={{ ...mutedTextStyle, fontSize: ".7rem" }}>{block.id}</code>
      {isCanvas && <PositionFields block={block} onChange={onChange} />}
      <BlockFields block={block} onChange={onChange} />
      <CommonFields block={block} onChange={onChange} />
    </div>
  );
}

/**
 * Absolute placement on a canvas-layout page — Phase 3B, Track 2 step 1.
 * Numeric fields only, matching this file's existing hotspot/labeledGraphic
 * percent-coordinate convention; a real drag/resize/rotate visual editor is
 * step 2 of this track.
 */
function PositionFields({ block, onChange }: { block: LeafBlock; onChange: Update }) {
  const position = block.position;
  return (
    <>
      <hr style={{ margin: "16px 0", border: 0, borderTop: "1px solid var(--color-border)" }} />
      <span style={{ ...labelStyle, marginTop: 0 }}>Position</span>

      {!position ? (
        <button
          type="button"
          style={{ fontSize: ".75rem" }}
          onClick={() => onChange({ ...block, position: { x: 0, y: 0, width: 200, height: 100, unit: "px" } })}
        >
          + Position
        </button>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <NumberField label="X" value={position.x} onChange={(x) => onChange({ ...block, position: { ...position, x } })} />
            <NumberField label="Y" value={position.y} onChange={(y) => onChange({ ...block, position: { ...position, y } })} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <NumberField label="Width" value={position.width} min={0} onChange={(width) => onChange({ ...block, position: { ...position, width } })} />
            <NumberField label="Height" value={position.height} min={0} onChange={(height) => onChange({ ...block, position: { ...position, height } })} />
          </div>
          <SelectField
            label="Unit"
            value={position.unit ?? "px"}
            options={["px", "percent"] as const}
            onChange={(unit) => onChange({ ...block, position: { ...position, unit } })}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <NumberField
              label="Rotation (degrees)"
              value={position.rotation ?? 0}
              min={-360}
              max={360}
              onChange={(rotation) => onChange({ ...block, position: { ...position, rotation: rotation || undefined } })}
            />
            <NumberField
              label="Layer order (z-index)"
              value={position.zIndex ?? 0}
              min={-999}
              max={999}
              onChange={(zIndex) => onChange({ ...block, position: { ...position, zIndex: zIndex || undefined } })}
            />
          </div>
          <NumberField
            label="Opacity (0–1)"
            value={position.opacity ?? 1}
            min={0}
            max={1}
            onChange={(opacity) => onChange({ ...block, position: { ...position, opacity } })}
          />
          <CheckboxField
            label="Locked (blocks further drag/resize once step 2's visual editor exists)"
            checked={position.locked ?? false}
            onChange={(locked) => onChange({ ...block, position: { ...position, locked: locked || undefined } })}
          />
          <button
            type="button"
            style={{ color: dangerColor, fontSize: ".75rem", marginTop: 10, background: "none", border: "none", padding: 0, cursor: "pointer" }}
            onClick={() => onChange({ ...block, position: undefined })}
          >
            Remove position (falls back to flow placement)
          </button>
        </>
      )}
    </>
  );
}

/**
 * Fields every block shares, including everything the accessibility gate can
 * require. The gate blocks publishing on missing alt text and on video or
 * audio with neither captions nor a transcript — so each of those must be
 * fixable from right here. A requirement an author cannot satisfy in the
 * editor is worse than no requirement.
 */
function CommonFields({ block, onChange }: { block: LeafBlock; onChange: Update }) {
  const needsAlt = block.type === "image" || block.type === "labeledGraphic" || block.type === "hotspot";
  const isTimedMedia = block.type === "video" || block.type === "audio";
  return (
    <>
      <hr style={{ margin: "16px 0", border: 0, borderTop: "1px solid var(--color-border)" }} />
      <span style={{ ...labelStyle, marginTop: 0 }}>Accessibility</span>

      {needsAlt && (
        <>
          <TextField
            label="Alt text"
            value={block.a11y?.altText ?? ""}
            placeholder="Describe the image for screen readers"
            onChange={(v) => onChange({ ...block, a11y: { ...block.a11y, altText: v } })}
          />
          <CheckboxField
            label="Decorative (skip for screen readers)"
            checked={block.a11y?.decorative ?? false}
            onChange={(v) => onChange({ ...block, a11y: { ...block.a11y, decorative: v } })}
          />
        </>
      )}

      {isTimedMedia && (
        <>
          <AssetSelectField
            label="Captions"
            value={block.a11y?.captionAssetId}
            hint="A WebVTT file from the content library. Either captions or a transcript is required to publish."
            onChange={(v) => onChange({ ...block, a11y: { ...block.a11y, captionAssetId: v } })}
          />
          <AssetSelectField
            label="Transcript"
            value={block.a11y?.transcriptAssetId}
            onChange={(v) => onChange({ ...block, a11y: { ...block.a11y, transcriptAssetId: v } })}
          />
        </>
      )}

      <TextField
        label="Accessible name"
        value={block.a11y?.label ?? ""}
        placeholder="Only if the visible label is not enough"
        onChange={(v) => onChange({ ...block, a11y: { ...block.a11y, label: v || undefined } })}
      />
      <CheckboxField
        label="Hidden until a trigger shows it"
        checked={block.initiallyHidden ?? false}
        onChange={(v) => onChange({ ...block, initiallyHidden: v || undefined })}
      />
    </>
  );
}

function BlockFields({ block, onChange }: { block: LeafBlock; onChange: Update }) {
  switch (block.type) {
    case "heading":
      return (
        <>
          <TextField label="Heading text" value={block.text} onChange={(v) => onChange({ ...block, text: v })} />
          <NumberField label="Level (1-6)" value={block.level} min={1} max={6} onChange={(v) => onChange({ ...block, level: v })} />
        </>
      );

    case "text":
      return <RichTextField label="Content" value={block.content} rows={8} onChange={(v) => onChange({ ...block, content: v })} />;

    case "list":
      return (
        <>
          <CheckboxField label="Numbered" checked={block.ordered ?? false} onChange={(v) => onChange({ ...block, ordered: v || undefined })} />
          {block.items.map((item, i) => (
            <div key={i}>
              <RichTextField
                label={`Item ${i + 1}`}
                value={item}
                rows={2}
                onChange={(v) => onChange({ ...block, items: replaceAt(block.items, i, v) })}
              />
              <ItemListControls
                addLabel="Item"
                canRemove={block.items.length > 1}
                onAdd={() => onChange({ ...block, items: [...block.items, richText("New item")] })}
                onRemove={() => onChange({ ...block, items: removeAt(block.items, i) })}
              />
            </div>
          ))}
        </>
      );

    case "quote":
      return (
        <>
          <RichTextField label="Quote" value={block.content} onChange={(v) => onChange({ ...block, content: v })} />
          <TextField label="Attribution" value={block.attribution ?? ""} onChange={(v) => onChange({ ...block, attribution: v || undefined })} />
        </>
      );

    case "statement":
      return (
        <>
          <RichTextField label="Content" value={block.content} onChange={(v) => onChange({ ...block, content: v })} />
          <SelectField
            label="Emphasis"
            value={block.emphasis}
            options={["note", "tip", "warning", "important", "quote"] as const}
            onChange={(v) => onChange({ ...block, emphasis: v })}
          />
        </>
      );

    case "divider":
      return (
        <SelectField label="Style" value={block.style} options={["line", "dotted", "space"] as const} onChange={(v) => onChange({ ...block, style: v })} />
      );

    case "spacer":
      return <SelectField label="Size" value={block.size} options={["small", "medium", "large"] as const} onChange={(v) => onChange({ ...block, size: v })} />;

    case "image":
      return (
        <>
          <RichTextField label="Caption" value={block.caption} rows={2} onChange={(v) => onChange({ ...block, caption: v })} />
          <SelectField label="Fit" value={block.fit} options={["contain", "cover"] as const} onChange={(v) => onChange({ ...block, fit: v })} />
        </>
      );

    case "imageGallery":
      return (
        <>
          <SelectField label="Presentation" value={block.presentation} options={["grid", "carousel"] as const} onChange={(v) => onChange({ ...block, presentation: v })} />
          {block.images.map((img, i) => (
            <div key={img.id} style={subBox}>
              <TextField label={`Image ${i + 1} alt text`} value={img.altText ?? ""} onChange={(v) => onChange({ ...block, images: replaceAt(block.images, i, { ...img, altText: v }) })} />
              <ItemListControls
                addLabel="Image slot"
                canRemove={block.images.length > 1}
                onAdd={() => onChange({ ...block, images: [...block.images, { ...img, id: specId("img"), altText: "" }] })}
                onRemove={() => onChange({ ...block, images: removeAt(block.images, i) })}
              />
            </div>
          ))}
        </>
      );

    case "video":
      return (
        <>
          <CheckboxField label="Autoplay" checked={block.autoplay ?? false} onChange={(v) => onChange({ ...block, autoplay: v || undefined })} />
          <CheckboxField
            label="Must be watched before continuing"
            checked={block.requireCompletion ?? false}
            onChange={(v) => onChange({ ...block, requireCompletion: v || undefined })}
          />
        </>
      );

    case "audio":
      return (
        <CheckboxField
          label="Must be heard before continuing"
          checked={block.requireCompletion ?? false}
          onChange={(v) => onChange({ ...block, requireCompletion: v || undefined })}
        />
      );

    case "embed":
      return (
        <>
          <SelectField
            label="Provider"
            value={block.provider}
            options={["youtube", "vimeo", "genially", "googleSlides", "codepen"] as const}
            onChange={(v) => onChange({ ...block, provider: v })}
          />
          <TextField label="Resource id" value={block.resourceId} placeholder="The id, not the full URL" onChange={(v) => onChange({ ...block, resourceId: v })} />
          <TextField label="Title" value={block.title} onChange={(v) => onChange({ ...block, title: v })} />
          <SelectField label="Aspect ratio" value={block.aspectRatio} options={["16:9", "4:3", "1:1"] as const} onChange={(v) => onChange({ ...block, aspectRatio: v })} />
        </>
      );

    case "accordion":
      return (
        <>
          {block.items.map((item, i) => (
            <div key={item.id} style={subBox}>
              <TextField label={`Section ${i + 1} title`} value={item.title} onChange={(v) => onChange({ ...block, items: replaceAt(block.items, i, { ...item, title: v }) })} />
              <RichTextField label="Content" value={item.content} onChange={(v) => onChange({ ...block, items: replaceAt(block.items, i, { ...item, content: v }) })} />
              <ItemListControls
                addLabel="Section"
                canRemove={block.items.length > 1}
                onAdd={() => onChange({ ...block, items: [...block.items, { id: specId("item"), title: "New section", content: richText("Content") }] })}
                onRemove={() => onChange({ ...block, items: removeAt(block.items, i) })}
              />
            </div>
          ))}
        </>
      );

    case "tabs":
      return (
        <>
          {block.tabs.map((tab, i) => (
            <div key={tab.id} style={subBox}>
              <TextField label={`Tab ${i + 1} label`} value={tab.label} onChange={(v) => onChange({ ...block, tabs: replaceAt(block.tabs, i, { ...tab, label: v }) })} />
              <RichTextField label="Content" value={tab.content} onChange={(v) => onChange({ ...block, tabs: replaceAt(block.tabs, i, { ...tab, content: v }) })} />
              <ItemListControls
                addLabel="Tab"
                canRemove={block.tabs.length > 1}
                onAdd={() => onChange({ ...block, tabs: [...block.tabs, { id: specId("tab"), label: "New tab", content: richText("Content") }] })}
                onRemove={() => onChange({ ...block, tabs: removeAt(block.tabs, i) })}
              />
            </div>
          ))}
        </>
      );

    case "flashcards":
      return (
        <>
          {block.cards.map((card, i) => (
            <div key={card.id} style={subBox}>
              <RichTextField label={`Card ${i + 1} front`} value={card.front} rows={2} onChange={(v) => onChange({ ...block, cards: replaceAt(block.cards, i, { ...card, front: v }) })} />
              <RichTextField label="Back" value={card.back} rows={2} onChange={(v) => onChange({ ...block, cards: replaceAt(block.cards, i, { ...card, back: v }) })} />
              <ItemListControls
                addLabel="Card"
                canRemove={block.cards.length > 1}
                onAdd={() => onChange({ ...block, cards: [...block.cards, { id: specId("card"), front: richText("Front"), back: richText("Back") }] })}
                onRemove={() => onChange({ ...block, cards: removeAt(block.cards, i) })}
              />
            </div>
          ))}
        </>
      );

    case "labeledGraphic":
      return (
        <>
          {block.markers.map((m, i) => (
            <div key={m.id} style={subBox}>
              <TextField label={`Marker ${i + 1} label`} value={m.label} onChange={(v) => onChange({ ...block, markers: replaceAt(block.markers, i, { ...m, label: v }) })} />
              <RichTextField label="Content" value={m.content} rows={2} onChange={(v) => onChange({ ...block, markers: replaceAt(block.markers, i, { ...m, content: v }) })} />
              <div style={{ display: "flex", gap: 8 }}>
                <NumberField label="X %" value={m.xPercent} min={0} max={100} onChange={(v) => onChange({ ...block, markers: replaceAt(block.markers, i, { ...m, xPercent: v }) })} />
                <NumberField label="Y %" value={m.yPercent} min={0} max={100} onChange={(v) => onChange({ ...block, markers: replaceAt(block.markers, i, { ...m, yPercent: v }) })} />
              </div>
              <ItemListControls
                addLabel="Marker"
                canRemove={block.markers.length > 1}
                onAdd={() => onChange({ ...block, markers: [...block.markers, { id: specId("marker"), xPercent: 50, yPercent: 50, label: "Marker", content: richText("Detail") }] })}
                onRemove={() => onChange({ ...block, markers: removeAt(block.markers, i) })}
              />
            </div>
          ))}
        </>
      );

    case "hotspot":
      return (
        <>
          <CheckboxField
            label="All hotspots must be opened to continue"
            checked={block.requireAllVisited ?? false}
            onChange={(v) => onChange({ ...block, requireAllVisited: v || undefined })}
          />
          {block.hotspots.map((h, i) => (
            <div key={h.id} style={subBox}>
              <TextField label={`Hotspot ${i + 1} label`} value={h.label} onChange={(v) => onChange({ ...block, hotspots: replaceAt(block.hotspots, i, { ...h, label: v }) })} />
              <RichTextField label="Content" value={h.content} rows={2} onChange={(v) => onChange({ ...block, hotspots: replaceAt(block.hotspots, i, { ...h, content: v }) })} />
              <SelectField label="Shape" value={h.shape} options={["rect", "circle"] as const} onChange={(v) => onChange({ ...block, hotspots: replaceAt(block.hotspots, i, { ...h, shape: v }) })} />
              <div style={{ display: "flex", gap: 8 }}>
                <NumberField label="X %" value={h.xPercent} min={0} max={100} onChange={(v) => onChange({ ...block, hotspots: replaceAt(block.hotspots, i, { ...h, xPercent: v }) })} />
                <NumberField label="Y %" value={h.yPercent} min={0} max={100} onChange={(v) => onChange({ ...block, hotspots: replaceAt(block.hotspots, i, { ...h, yPercent: v }) })} />
                <NumberField label="W %" value={h.widthPercent} min={0} max={100} onChange={(v) => onChange({ ...block, hotspots: replaceAt(block.hotspots, i, { ...h, widthPercent: v }) })} />
                <NumberField label="H %" value={h.heightPercent} min={0} max={100} onChange={(v) => onChange({ ...block, hotspots: replaceAt(block.hotspots, i, { ...h, heightPercent: v }) })} />
              </div>
              <ItemListControls
                addLabel="Hotspot"
                canRemove={block.hotspots.length > 1}
                onAdd={() => onChange({ ...block, hotspots: [...block.hotspots, { id: specId("spot"), shape: "rect", xPercent: 25, yPercent: 25, widthPercent: 20, heightPercent: 20, label: "Hotspot", content: richText("Detail") }] })}
                onRemove={() => onChange({ ...block, hotspots: removeAt(block.hotspots, i) })}
              />
            </div>
          ))}
        </>
      );

    case "process":
      return (
        <>
          <SelectField label="Presentation" value={block.presentation} options={["steps", "timeline"] as const} onChange={(v) => onChange({ ...block, presentation: v })} />
          {block.steps.map((s, i) => (
            <div key={s.id} style={subBox}>
              <TextField label={`Step ${i + 1} title`} value={s.title} onChange={(v) => onChange({ ...block, steps: replaceAt(block.steps, i, { ...s, title: v }) })} />
              <RichTextField label="Content" value={s.content} rows={2} onChange={(v) => onChange({ ...block, steps: replaceAt(block.steps, i, { ...s, content: v }) })} />
              <ItemListControls
                addLabel="Step"
                canRemove={block.steps.length > 1}
                onAdd={() => onChange({ ...block, steps: [...block.steps, { id: specId("step"), title: "New step", content: richText("What happens.") }] })}
                onRemove={() => onChange({ ...block, steps: removeAt(block.steps, i) })}
              />
            </div>
          ))}
        </>
      );

    case "sorting":
      return (
        <>
          {block.categories.map((c, i) => (
            <div key={c.id} style={subBox}>
              <TextField label={`Category ${i + 1}`} value={c.label} onChange={(v) => onChange({ ...block, categories: replaceAt(block.categories, i, { ...c, label: v }) })} />
              <ItemListControls
                addLabel="Category"
                canRemove={block.categories.length > 2}
                onAdd={() => onChange({ ...block, categories: [...block.categories, { id: specId("cat"), label: "New category" }] })}
                onRemove={() => {
                  // Cards pointing at a removed category would fail validation,
                  // so they move to the first surviving one rather than dangle.
                  const remaining = removeAt(block.categories, i);
                  const fallback = remaining[0].id;
                  onChange({
                    ...block,
                    categories: remaining,
                    cards: block.cards.map((card) => (card.categoryId === c.id ? { ...card, categoryId: fallback } : card)),
                  });
                }}
              />
            </div>
          ))}
          {block.cards.map((card, i) => (
            <div key={card.id} style={subBox}>
              <RichTextField label={`Card ${i + 1}`} value={card.text} rows={2} onChange={(v) => onChange({ ...block, cards: replaceAt(block.cards, i, { ...card, text: v }) })} />
              <Field label="Belongs to">
                <select
                  style={fieldStyle}
                  value={card.categoryId}
                  onChange={(e) => onChange({ ...block, cards: replaceAt(block.cards, i, { ...card, categoryId: e.target.value }) })}
                >
                  {block.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <ItemListControls
                addLabel="Card"
                canRemove={block.cards.length > 2}
                onAdd={() => onChange({ ...block, cards: [...block.cards, { id: specId("card"), text: richText("New card"), categoryId: block.categories[0].id }] })}
                onRemove={() => onChange({ ...block, cards: removeAt(block.cards, i) })}
              />
            </div>
          ))}
        </>
      );

    case "scenario":
      return (
        <>
          <RichTextField label="Setting" value={block.setting} rows={2} onChange={(v) => onChange({ ...block, setting: v })} />
          {block.steps.map((step, i) => (
            <div key={step.id} style={subBox}>
              <TextField label={`Step ${i + 1} speaker`} value={step.speaker ?? ""} onChange={(v) => onChange({ ...block, steps: replaceAt(block.steps, i, { ...step, speaker: v || undefined }) })} />
              <RichTextField label="Message" value={step.message} rows={2} onChange={(v) => onChange({ ...block, steps: replaceAt(block.steps, i, { ...step, message: v }) })} />
              {(step.choices ?? []).map((choice, ci) => (
                <div key={choice.id} style={{ ...subBox, background: "var(--color-muted)" }}>
                  <RichTextField
                    label={`Choice ${ci + 1}`}
                    value={choice.text}
                    rows={2}
                    onChange={(v) =>
                      onChange({ ...block, steps: replaceAt(block.steps, i, { ...step, choices: replaceAt(step.choices ?? [], ci, { ...choice, text: v }) }) })
                    }
                  />
                  <RichTextField
                    label="Feedback"
                    value={choice.feedback}
                    rows={2}
                    onChange={(v) =>
                      onChange({ ...block, steps: replaceAt(block.steps, i, { ...step, choices: replaceAt(step.choices ?? [], ci, { ...choice, feedback: v }) }) })
                    }
                  />
                  <Field label="Goes to step">
                    <select
                      style={fieldStyle}
                      value={choice.nextStepId ?? ""}
                      onChange={(e) =>
                        onChange({
                          ...block,
                          steps: replaceAt(block.steps, i, {
                            ...step,
                            choices: replaceAt(step.choices ?? [], ci, { ...choice, nextStepId: e.target.value || undefined }),
                          }),
                        })
                      }
                    >
                      <option value="">(end of scenario)</option>
                      {block.steps.map((s, si) => (
                        <option key={s.id} value={s.id}>
                          Step {si + 1}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <CheckboxField
                    label="Preferred answer"
                    checked={choice.preferred ?? false}
                    onChange={(v) =>
                      onChange({ ...block, steps: replaceAt(block.steps, i, { ...step, choices: replaceAt(step.choices ?? [], ci, { ...choice, preferred: v || undefined }) }) })
                    }
                  />
                  <ItemListControls
                    addLabel="Choice"
                    canRemove={(step.choices ?? []).length > 1}
                    onAdd={() =>
                      onChange({ ...block, steps: replaceAt(block.steps, i, { ...step, choices: [...(step.choices ?? []), { id: specId("choice"), text: richText("Another option") }] }) })
                    }
                    onRemove={() => onChange({ ...block, steps: replaceAt(block.steps, i, { ...step, choices: removeAt(step.choices ?? [], ci) }) })}
                  />
                </div>
              ))}
              <ItemListControls
                addLabel="Step"
                canRemove={block.steps.length > 1}
                onAdd={() => onChange({ ...block, steps: [...block.steps, { id: specId("step"), message: richText("What happens next?"), choices: [{ id: specId("choice"), text: richText("An option") }] }] })}
                onRemove={() => {
                  // Choices pointing at the removed step would dangle.
                  const remaining = removeAt(block.steps, i);
                  onChange({
                    ...block,
                    steps: remaining.map((s) => ({
                      ...s,
                      choices: (s.choices ?? []).map((c) => (c.nextStepId === step.id ? { ...c, nextStepId: undefined } : c)),
                    })),
                  });
                }}
              />
            </div>
          ))}
        </>
      );

    case "knowledgeCheck":
    case "quiz":
      return <QuizFields block={block} onChange={onChange} />;

    case "continue":
      return <TextField label="Button label" value={block.label ?? ""} onChange={(v) => onChange({ ...block, label: v || undefined })} />;

    case "component":
      return (
        <>
          <p style={{ ...mutedTextStyle, fontSize: ".8rem" }}>
            This is a reference to a saved block. Editing the saved block updates every course that uses it.
          </p>
          <TextField label="Title override" value={block.overrides?.title ?? ""} onChange={(v) => onChange({ ...block, overrides: { ...block.overrides, title: v || undefined } })} />
        </>
      );

    default: {
      const exhaustive: never = block;
      return <p style={{ color: dangerColor }}>No editor for {(exhaustive as { type: string }).type}.</p>;
    }
  }
}

function QuizFields({
  block,
  onChange,
}: {
  block: Extract<LeafBlock, { type: "quiz" | "knowledgeCheck" }>;
  onChange: Update;
}) {
  return (
    <>
      {block.type === "quiz" && (
        <>
          <TextField label="Quiz title" value={block.title ?? ""} onChange={(v) => onChange({ ...block, title: v || undefined })} />
          <NumberField label="Passing score %" value={block.passingScorePercent} min={0} max={100} onChange={(v) => onChange({ ...block, passingScorePercent: v })} />
          <CheckboxField label="Show results after submitting" checked={block.showResults !== false} onChange={(v) => onChange({ ...block, showResults: v })} />
          <CheckboxField label="Allow retry" checked={block.allowRetry !== false} onChange={(v) => onChange({ ...block, allowRetry: v })} />
        </>
      )}

      {block.items.map((item, i) => (
        <div key={item.id} style={subBox}>
          <RichTextField label={`Question ${i + 1}`} value={item.prompt} rows={2} onChange={(v) => onChange({ ...block, items: replaceAt(block.items, i, { ...item, prompt: v }) })} />

          <Field label="Type">
            <select
              style={fieldStyle}
              value={item.kind}
              onChange={(e) => onChange({ ...block, items: replaceAt(block.items, i, convertItem(item, e.target.value)) })}
            >
              <option value="multipleChoice">Multiple choice (one answer)</option>
              <option value="multipleResponse">Multiple response (several answers)</option>
              <option value="trueFalse">True / false</option>
              <option value="fillBlank">Fill in the blank</option>
              <option value="sequencing">Put in order</option>
            </select>
          </Field>

          {(item.kind === "multipleChoice" || item.kind === "multipleResponse") && (
            <>
              {item.choices.map((choice, ci) => (
                <div key={choice.id} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 6 }}>
                  <input
                    type={item.kind === "multipleChoice" ? "radio" : "checkbox"}
                    name={`correct-${item.id}`}
                    checked={choice.correct ?? false}
                    title="Correct answer"
                    style={{ marginTop: 10 }}
                    onChange={(e) => {
                      const choices =
                        item.kind === "multipleChoice"
                          ? // Exactly one correct choice, enforced here rather
                            // than left for the validator to complain about.
                            item.choices.map((c, idx) => ({ ...c, correct: idx === ci }))
                          : replaceAt(item.choices, ci, { ...choice, correct: e.target.checked });
                      onChange({ ...block, items: replaceAt(block.items, i, { ...item, choices }) });
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <input
                      style={fieldStyle}
                      value={choice.text.blocks[0]?.spans[0]?.text ?? ""}
                      onChange={(e) =>
                        onChange({ ...block, items: replaceAt(block.items, i, { ...item, choices: replaceAt(item.choices, ci, { ...choice, text: richText(e.target.value) }) }) })
                      }
                    />
                  </div>
                  {item.choices.length > 2 && (
                    <button
                      type="button"
                      style={{ color: dangerColor, fontSize: ".75rem" }}
                      onClick={() => onChange({ ...block, items: replaceAt(block.items, i, { ...item, choices: removeAt(item.choices, ci) }) })}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                style={{ fontSize: ".75rem", marginTop: 6 }}
                onClick={() => onChange({ ...block, items: replaceAt(block.items, i, { ...item, choices: [...item.choices, { id: specId("opt"), text: richText("New option") }] }) })}
              >
                + Option
              </button>
            </>
          )}

          {item.kind === "trueFalse" && (
            <Field label="Correct answer">
              <select
                style={fieldStyle}
                value={String(item.answer)}
                onChange={(e) => onChange({ ...block, items: replaceAt(block.items, i, { ...item, answer: e.target.value === "true" }) })}
              >
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            </Field>
          )}

          {item.kind === "fillBlank" && (
            <>
              <TextField
                label="Accepted answers (comma separated)"
                value={item.acceptedAnswers.join(", ")}
                onChange={(v) =>
                  onChange({
                    ...block,
                    items: replaceAt(block.items, i, {
                      ...item,
                      acceptedAnswers: v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50) || [""],
                    }),
                  })
                }
              />
              <CheckboxField
                label="Case sensitive"
                checked={item.caseSensitive ?? false}
                onChange={(v) => onChange({ ...block, items: replaceAt(block.items, i, { ...item, caseSensitive: v || undefined }) })}
              />
            </>
          )}

          {item.kind === "sequencing" && (
            <>
              <span style={labelStyle}>Steps, in the correct order</span>
              {item.steps.map((s, si) => (
                <input
                  key={s.id}
                  style={{ ...fieldStyle, marginTop: 4 }}
                  value={s.text.blocks[0]?.spans[0]?.text ?? ""}
                  onChange={(e) => onChange({ ...block, items: replaceAt(block.items, i, { ...item, steps: replaceAt(item.steps, si, { ...s, text: richText(e.target.value) }) }) })}
                />
              ))}
              <button
                type="button"
                style={{ fontSize: ".75rem", marginTop: 6 }}
                onClick={() => onChange({ ...block, items: replaceAt(block.items, i, { ...item, steps: [...item.steps, { id: specId("step"), text: richText("Next step") }] }) })}
              >
                + Step
              </button>
            </>
          )}

          <ItemListControls
            addLabel="Question"
            canRemove={block.items.length > 1}
            onAdd={() =>
              onChange({
                ...block,
                items: [
                  ...block.items,
                  {
                    id: specId("q"),
                    kind: "multipleChoice",
                    prompt: richText("New question"),
                    choices: [
                      { id: specId("opt"), text: richText("Correct answer"), correct: true },
                      { id: specId("opt"), text: richText("Distractor") },
                    ],
                  },
                ],
              })
            }
            onRemove={() => onChange({ ...block, items: removeAt(block.items, i) })}
          />
        </div>
      ))}
    </>
  );
}

/**
 * Switching question type rebuilds the item for the new kind.
 *
 * The kinds have disjoint required fields, so carrying the old ones across
 * would produce a shape the strict schema rejects; the prompt and id are the
 * only things that genuinely survive.
 */
function convertItem(item: { id: string; prompt: ReturnType<typeof richText> }, kind: string) {
  const base = { id: item.id, prompt: item.prompt };
  switch (kind) {
    case "multipleResponse":
      return {
        ...base,
        kind: "multipleResponse" as const,
        choices: [
          { id: specId("opt"), text: richText("Correct answer"), correct: true },
          { id: specId("opt"), text: richText("Another correct answer"), correct: true },
          { id: specId("opt"), text: richText("Distractor") },
        ],
      };
    case "trueFalse":
      return { ...base, kind: "trueFalse" as const, answer: true };
    case "fillBlank":
      return { ...base, kind: "fillBlank" as const, acceptedAnswers: ["answer"], trimWhitespace: true };
    case "sequencing":
      return {
        ...base,
        kind: "sequencing" as const,
        steps: [
          { id: specId("step"), text: richText("First") },
          { id: specId("step"), text: richText("Second") },
        ],
      };
    default:
      return {
        ...base,
        kind: "multipleChoice" as const,
        choices: [
          { id: specId("opt"), text: richText("Correct answer"), correct: true },
          { id: specId("opt"), text: richText("Distractor") },
        ],
      };
  }
}

function replaceAt<T>(arr: T[], index: number, value: T): T[] {
  const next = [...arr];
  next[index] = value;
  return next;
}

function removeAt<T>(arr: T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}
