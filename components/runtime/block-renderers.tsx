"use client";

import { useState } from "react";
import type { LeafBlockType as LeafBlock, RichText, Trigger } from "@/lib/spec";
import { currentBlockStateId, isBlockVisible } from "@/lib/runtime/engine";
import type { RuntimeState } from "@/lib/runtime/types";
import { useAssetUrl } from "@/lib/runtime/use-asset-url";

/**
 * One renderer per leaf block type in lib/spec/blocks.ts's closed 24-type
 * set, dispatched by `renderBlock`. Presentational only — all interaction
 * logic lives in lib/runtime/engine.ts; a renderer's `onEvent` call is the
 * entire extent of what it decides for itself.
 */

type TriggerEventName = Trigger["when"];

export interface BlockRenderCtx {
  state: RuntimeState;
  onEvent: (blockId: string, when: TriggerEventName, onId?: string) => void;
  onSubmitQuiz: (blockId: string, answers: Record<string, unknown>) => void;
}

const box: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 12 };
const mutedText: React.CSSProperties = { color: "#555" };

// --------------------------------------------------------------- rich text

function renderInlineSpan(span: RichText["blocks"][number]["spans"][number], key: number) {
  let node: React.ReactNode = span.text;
  for (const mark of span.marks ?? []) {
    switch (mark) {
      case "bold":
        node = <strong>{node}</strong>;
        break;
      case "italic":
        node = <em>{node}</em>;
        break;
      case "underline":
        node = <u>{node}</u>;
        break;
      case "strikethrough":
        node = <s>{node}</s>;
        break;
      case "code":
        node = <code>{node}</code>;
        break;
      case "subscript":
        node = <sub>{node}</sub>;
        break;
      case "superscript":
        node = <sup>{node}</sup>;
        break;
    }
  }
  if (span.link) {
    node = (
      <a href={span.link.href} target={span.link.newTab ? "_blank" : undefined} rel="noopener noreferrer">
        {node}
      </a>
    );
  }
  return <span key={key}>{node}</span>;
}

/** Groups consecutive list-kind entries into real <ul>/<ol> for correct semantics. */
export function renderRichText(rt: RichText | undefined): React.ReactNode {
  if (!rt) return null;
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < rt.blocks.length) {
    const b = rt.blocks[i];
    if (b.kind === "bulletItem" || b.kind === "numberItem") {
      const items: typeof rt.blocks = [];
      const kind = b.kind;
      while (i < rt.blocks.length && rt.blocks[i].kind === kind) {
        items.push(rt.blocks[i]);
        i++;
      }
      const ListTag = kind === "bulletItem" ? "ul" : "ol";
      out.push(
        <ListTag key={out.length}>
          {items.map((li, li_i) => (
            <li key={li_i}>{li.spans.map((s, si) => renderInlineSpan(s, si))}</li>
          ))}
        </ListTag>
      );
      continue;
    }
    const Tag = b.kind === "quote" ? "blockquote" : b.kind === "codeBlock" ? "pre" : "p";
    out.push(<Tag key={i}>{b.spans.map((s, si) => renderInlineSpan(s, si))}</Tag>);
    i++;
  }
  return <>{out}</>;
}

// ----------------------------------------------------------------- media

function AssetImage({ assetId, alt }: { assetId: string; alt: string }) {
  const url = useAssetUrl(assetId);
  if (!url) return <div style={{ ...mutedText, fontSize: ".85rem" }}>Loading image…</div>;
  // eslint-disable-next-line @next/next/no-img-element -- signed URLs from private storage; next/image's remote-pattern allowlist would have to track every signed host, for no real benefit here.
  return <img src={url} alt={alt} style={{ maxWidth: "100%", borderRadius: 6 }} />;
}

function AssetVideo({ assetId, autoPlay, onEnded }: { assetId: string; autoPlay?: boolean; onEnded?: () => void }) {
  const url = useAssetUrl(assetId);
  if (!url) return <div style={{ ...mutedText, fontSize: ".85rem" }}>Loading video…</div>;
  return <video controls autoPlay={autoPlay} onEnded={onEnded} src={url} style={{ width: "100%", borderRadius: 6 }} />;
}

function AssetAudio({ assetId, onEnded }: { assetId: string; onEnded?: () => void }) {
  const url = useAssetUrl(assetId);
  if (!url) return <div style={{ ...mutedText, fontSize: ".85rem" }}>Loading audio…</div>;
  return <audio controls onEnded={onEnded} src={url} style={{ width: "100%" }} />;
}

// ----------------------------------------------------------- 24 renderers

function TextBlockView({ block }: { block: Extract<LeafBlock, { type: "text" }> }) {
  return <div>{renderRichText(block.content)}</div>;
}

function HeadingBlockView({ block }: { block: Extract<LeafBlock, { type: "heading" }> }) {
  const Tag = `h${block.level ?? 2}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return <Tag>{block.text}</Tag>;
}

function ListBlockView({ block }: { block: Extract<LeafBlock, { type: "list" }> }) {
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag>
      {block.items.map((item, i) => (
        <li key={i}>{renderRichText(item)}</li>
      ))}
    </Tag>
  );
}

function QuoteBlockView({ block }: { block: Extract<LeafBlock, { type: "quote" }> }) {
  return (
    <blockquote style={{ borderLeft: "3px solid #ccc", paddingLeft: 12 }}>
      {renderRichText(block.content)}
      {block.attribution && <footer style={mutedText}>— {block.attribution}</footer>}
    </blockquote>
  );
}

function StatementBlockView({ block }: { block: Extract<LeafBlock, { type: "statement" }> }) {
  return (
    <div style={{ ...box, background: "#f6f8fa" }} role={block.emphasis === "warning" ? "alert" : undefined}>
      {block.emphasis && <strong style={{ display: "block", marginBottom: 4 }}>{block.emphasis.toUpperCase()}</strong>}
      {renderRichText(block.content)}
    </div>
  );
}

function DividerBlockView({ block }: { block: Extract<LeafBlock, { type: "divider" }> }) {
  if (block.style === "space") return <div style={{ height: 24 }} />;
  return <hr style={{ borderStyle: block.style === "dotted" ? "dotted" : "solid" }} />;
}

function SpacerBlockView({ block }: { block: Extract<LeafBlock, { type: "spacer" }> }) {
  const px = block.size === "large" ? 48 : block.size === "small" ? 12 : 24;
  return <div style={{ height: px }} />;
}

function ImageBlockView({ block }: { block: Extract<LeafBlock, { type: "image" }> }) {
  return (
    <figure>
      <AssetImage assetId={block.assetId} alt={block.a11y?.altText ?? ""} />
      {block.caption && <figcaption style={mutedText}>{renderRichText(block.caption)}</figcaption>}
    </figure>
  );
}

function ImageGalleryBlockView({ block }: { block: Extract<LeafBlock, { type: "imageGallery" }> }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
      {block.images.map((img) => (
        <figure key={img.id} style={{ margin: 0 }}>
          <AssetImage assetId={img.assetId} alt={img.altText ?? ""} />
          {img.caption && <figcaption style={{ ...mutedText, fontSize: ".8rem" }}>{renderRichText(img.caption)}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

function VideoBlockView({ block, ctx }: { block: Extract<LeafBlock, { type: "video" }>; ctx: BlockRenderCtx }) {
  return (
    <AssetVideo
      assetId={block.assetId}
      autoPlay={block.autoplay}
      onEnded={() => ctx.onEvent(block.id, "mediaComplete")}
    />
  );
}

function AudioBlockView({ block, ctx }: { block: Extract<LeafBlock, { type: "audio" }>; ctx: BlockRenderCtx }) {
  return <AssetAudio assetId={block.assetId} onEnded={() => ctx.onEvent(block.id, "mediaComplete")} />;
}

const EMBED_ORIGINS: Record<string, (id: string) => string> = {
  youtube: (id) => `https://www.youtube.com/embed/${id}`,
  vimeo: (id) => `https://player.vimeo.com/video/${id}`,
  genially: (id) => `https://view.genially.com/${id}`,
  googleSlides: (id) => `https://docs.google.com/presentation/d/${id}/embed`,
  codepen: (id) => `https://codepen.io/embed/${id}`,
};

function EmbedBlockView({ block }: { block: Extract<LeafBlock, { type: "embed" }> }) {
  const src = EMBED_ORIGINS[block.provider]?.(block.resourceId);
  const ratio = block.aspectRatio === "4:3" ? "75%" : block.aspectRatio === "1:1" ? "100%" : "56.25%";
  if (!src) return null;
  return (
    <div style={{ position: "relative", paddingTop: ratio }}>
      <iframe
        title={block.title}
        src={src}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        allowFullScreen
        // Defense-in-depth on top of the fixed-origin allowlist above (the
        // provider host is never author-controlled): no allow-top-navigation
        // (an embedded page can't redirect or replace the real app tab) and
        // no allow-modals (no native-looking fake dialog), matching the same
        // exclusions the SCORM bridge iframe uses (IsolatedScormPlayer.tsx).
        sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
      />
    </div>
  );
}

function AccordionBlockView({ block, ctx }: { block: Extract<LeafBlock, { type: "accordion" }>; ctx: BlockRenderCtx }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div>
      {block.items.map((item) => (
        <div key={item.id} style={{ borderBottom: "1px solid #eee" }}>
          <button
            onClick={() => {
              setOpenId(openId === item.id ? null : item.id);
              ctx.onEvent(block.id, "click", item.id);
            }}
            aria-expanded={openId === item.id}
            style={{ width: "100%", textAlign: "left", padding: "8px 0", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}
          >
            {item.title}
          </button>
          {openId === item.id && <div style={{ paddingBottom: 8 }}>{renderRichText(item.content)}</div>}
        </div>
      ))}
    </div>
  );
}

function TabsBlockView({ block, ctx }: { block: Extract<LeafBlock, { type: "tabs" }>; ctx: BlockRenderCtx }) {
  const [activeId, setActiveId] = useState(block.tabs[0]?.id);
  const active = block.tabs.find((t) => t.id === activeId);
  return (
    <div>
      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid #ddd" }}>
        {block.tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            onClick={() => {
              setActiveId(tab.id);
              ctx.onEvent(block.id, "click", tab.id);
            }}
            style={{
              padding: "6px 12px",
              border: "none",
              borderBottom: tab.id === activeId ? "2px solid #333" : "2px solid transparent",
              background: "none",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {active && <div style={{ paddingTop: 12 }}>{renderRichText(active.content)}</div>}
    </div>
  );
}

function FlashcardsBlockView({ block, ctx }: { block: Extract<LeafBlock, { type: "flashcards" }>; ctx: BlockRenderCtx }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = block.cards[index];
  if (!card) return null;
  return (
    <div>
      <div
        onClick={() => {
          setFlipped((f) => !f);
          ctx.onEvent(block.id, "click", card.id);
        }}
        style={{ ...box, cursor: "pointer", minHeight: 100, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}
      >
        {renderRichText(flipped ? card.back : card.front)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <button
          disabled={index === 0}
          onClick={() => {
            setIndex((i) => Math.max(0, i - 1));
            setFlipped(false);
          }}
        >
          Previous
        </button>
        <span style={mutedText}>
          {index + 1} / {block.cards.length}
        </span>
        <button
          disabled={index === block.cards.length - 1}
          onClick={() => {
            setIndex((i) => Math.min(block.cards.length - 1, i + 1));
            setFlipped(false);
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function LabeledGraphicBlockView({ block, ctx }: { block: Extract<LeafBlock, { type: "labeledGraphic" }>; ctx: BlockRenderCtx }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div style={{ position: "relative" }}>
      <AssetImage assetId={block.assetId} alt={block.a11y?.altText ?? ""} />
      {block.markers.map((m) => (
        <button
          key={m.id}
          onClick={() => {
            setOpenId(openId === m.id ? null : m.id);
            ctx.onEvent(block.id, "click", m.id);
          }}
          aria-label={m.label}
          style={{
            position: "absolute",
            left: `${m.xPercent}%`,
            top: `${m.yPercent}%`,
            transform: "translate(-50%, -50%)",
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "#2a6ed6",
            color: "#fff",
            border: "2px solid #fff",
            cursor: "pointer",
          }}
        >
          +
        </button>
      ))}
      {openId && (
        <div style={box}>
          {block.markers.find((m) => m.id === openId)?.label}
          {block.markers.find((m) => m.id === openId)?.content && renderRichText(block.markers.find((m) => m.id === openId)!.content)}
        </div>
      )}
    </div>
  );
}

function HotspotBlockView({ block, ctx, state }: { block: Extract<LeafBlock, { type: "hotspot" }>; ctx: BlockRenderCtx; state: RuntimeState }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const visited = (state.blockCurrentStateId[block.id] ?? "").split(",").filter(Boolean);
  const allVisited = block.requireAllVisited ? block.hotspots.every((h) => visited.includes(h.id)) : true;
  return (
    <div style={{ position: "relative" }}>
      <AssetImage assetId={block.assetId} alt={block.a11y?.altText ?? ""} />
      {block.hotspots.map((h) => (
        <button
          key={h.id}
          onClick={() => {
            setOpenId(h.id);
            ctx.onEvent(block.id, "click", h.id);
          }}
          aria-label={h.label}
          style={{
            position: "absolute",
            left: `${h.xPercent}%`,
            top: `${h.yPercent}%`,
            width: `${h.widthPercent}%`,
            height: `${h.heightPercent}%`,
            borderRadius: h.shape === "circle" ? "50%" : 4,
            border: "2px dashed #2a6ed6",
            background: "rgba(42,110,214,0.15)",
            cursor: "pointer",
          }}
        />
      ))}
      {openId && <div style={box}>{renderRichText(block.hotspots.find((h) => h.id === openId)?.content)}</div>}
      {block.requireAllVisited && !allVisited && (
        <p style={{ ...mutedText, fontSize: ".8rem" }}>Explore every hotspot to continue.</p>
      )}
    </div>
  );
}

function ProcessBlockView({ block }: { block: Extract<LeafBlock, { type: "process" }> }) {
  return (
    <ol style={{ display: "flex", flexDirection: block.presentation === "timeline" ? "column" : "row", gap: 12, flexWrap: "wrap", listStyle: "none", padding: 0 }}>
      {block.steps.map((step, i) => (
        <li key={step.id} style={{ ...box, flex: "1 1 160px" }}>
          <strong>
            {i + 1}. {step.title}
          </strong>
          {step.content && <div>{renderRichText(step.content)}</div>}
        </li>
      ))}
    </ol>
  );
}

function SortingBlockView({ block, ctx }: { block: Extract<LeafBlock, { type: "sorting" }>; ctx: BlockRenderCtx }) {
  const [placement, setPlacement] = useState<Record<string, string>>({});
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        {block.cards
          .filter((c) => !placement[c.id])
          .map((c) => (
            <span key={c.id} style={{ ...box, marginBottom: 0, padding: "4px 8px" }}>
              {renderRichText(c.text)}
            </span>
          ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${block.categories.length}, 1fr)`, gap: 8 }}>
        {block.categories.map((cat) => (
          <div key={cat.id} style={box}>
            <strong>{cat.label}</strong>
            {block.cards
              .filter((c) => placement[c.id] === cat.id)
              .map((c) => (
                <div key={c.id}>{renderRichText(c.text)}</div>
              ))}
            {block.cards
              .filter((c) => !placement[c.id])
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    const next = { ...placement, [c.id]: cat.id };
                    setPlacement(next);
                    if (Object.keys(next).length === block.cards.length) ctx.onEvent(block.id, "blockComplete");
                  }}
                  style={{ display: "block", fontSize: ".8rem", marginTop: 4 }}
                >
                  Place &ldquo;{c.text.blocks[0]?.spans[0]?.text ?? "card"}&rdquo; here
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScenarioBlockView({ block, ctx }: { block: Extract<LeafBlock, { type: "scenario" }>; ctx: BlockRenderCtx }) {
  const [stepId, setStepId] = useState(block.steps[0]?.id);
  const step = block.steps.find((s) => s.id === stepId);
  if (!step) return null;
  return (
    <div>
      {block.setting && <div style={{ ...mutedText, marginBottom: 8 }}>{renderRichText(block.setting)}</div>}
      <div style={box}>
        {step.speaker && <strong>{step.speaker}: </strong>}
        {renderRichText(step.message)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {(step.choices ?? []).map((choice) => (
          <button
            key={choice.id}
            onClick={() => {
              ctx.onEvent(block.id, "click", choice.id);
              if (choice.nextStepId) setStepId(choice.nextStepId);
            }}
            style={{ textAlign: "left", padding: 8 }}
          >
            {renderRichText(choice.text)}
          </button>
        ))}
      </div>
    </div>
  );
}

function itemPrompt(prompt: RichText) {
  return renderRichText(prompt);
}

function AssessmentItemView({
  item,
  answer,
  onChange,
}: {
  item: Extract<LeafBlock, { type: "quiz" }>["items"][number];
  answer: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (item.kind) {
    case "multipleChoice":
      return (
        <fieldset style={{ border: "none", padding: 0 }}>
          <legend>{itemPrompt(item.prompt)}</legend>
          {item.choices.map((c) => (
            <label key={c.id} style={{ display: "block" }}>
              <input type="radio" name={item.id} checked={answer === c.id} onChange={() => onChange(c.id)} /> {renderRichText(c.text)}
            </label>
          ))}
        </fieldset>
      );
    case "multipleResponse": {
      const selected = new Set(Array.isArray(answer) ? (answer as string[]) : []);
      return (
        <fieldset style={{ border: "none", padding: 0 }}>
          <legend>{itemPrompt(item.prompt)}</legend>
          {item.choices.map((c) => (
            <label key={c.id} style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  onChange([...next]);
                }}
              />{" "}
              {renderRichText(c.text)}
            </label>
          ))}
        </fieldset>
      );
    }
    case "trueFalse":
      return (
        <fieldset style={{ border: "none", padding: 0 }}>
          <legend>{itemPrompt(item.prompt)}</legend>
          <label style={{ display: "block" }}>
            <input type="radio" name={item.id} checked={answer === true} onChange={() => onChange(true)} /> True
          </label>
          <label style={{ display: "block" }}>
            <input type="radio" name={item.id} checked={answer === false} onChange={() => onChange(false)} /> False
          </label>
        </fieldset>
      );
    case "fillBlank":
      return (
        <div>
          <div>{itemPrompt(item.prompt)}</div>
          <input type="text" value={typeof answer === "string" ? answer : ""} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "sequencing": {
      const order: string[] = Array.isArray(answer) ? (answer as string[]) : item.steps.map((s) => s.id);
      const move = (from: number, to: number) => {
        if (to < 0 || to >= order.length) return;
        const next = [...order];
        [next[from], next[to]] = [next[to], next[from]];
        onChange(next);
      };
      return (
        <div>
          <div>{itemPrompt(item.prompt)}</div>
          <ol>
            {order.map((id, i) => {
              const stepText = item.steps.find((s) => s.id === id)?.text;
              return (
                <li key={id}>
                  {stepText && renderRichText(stepText)}
                  <button onClick={() => move(i, i - 1)} disabled={i === 0} style={{ marginLeft: 8 }}>
                    ↑
                  </button>
                  <button onClick={() => move(i, i + 1)} disabled={i === order.length - 1}>
                    ↓
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      );
    }
    default:
      return null;
  }
}

function QuizLikeBlockView({
  block,
  ctx,
  container,
}: {
  block: Extract<LeafBlock, { type: "quiz" | "knowledgeCheck" }>;
  ctx: BlockRenderCtx;
  container: "quiz" | "knowledgeCheck";
}) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const attempt = ctx.state.quizAttempts[block.id];
  const alreadySubmitted = !!attempt;
  const allowRetry = container === "quiz" ? (block as Extract<LeafBlock, { type: "quiz" }>).allowRetry !== false : true;
  const showResults = container === "quiz" ? (block as Extract<LeafBlock, { type: "quiz" }>).showResults !== false : true;

  return (
    <div style={box}>
      {"title" in block && block.title && <h3>{block.title}</h3>}
      {block.items.map((item) => (
        <div key={item.id} style={{ marginBottom: 16 }}>
          <AssessmentItemView
            item={item}
            answer={answers[item.id]}
            onChange={(value) => setAnswers((prev) => ({ ...prev, [item.id]: value }))}
          />
        </div>
      ))}
      {(!alreadySubmitted || allowRetry) && (
        <button
          onClick={() => {
            ctx.onSubmitQuiz(block.id, answers);
          }}
        >
          Submit
        </button>
      )}
      {alreadySubmitted && showResults && (
        <p style={{ color: attempt.passed ? "#227a53" : "#b23a3a" }}>
          Score: {attempt.scorePercent}% — {attempt.passed ? "Passed" : "Not yet passed"}
        </p>
      )}
    </div>
  );
}

function ContinueBlockView({ block, ctx, state }: { block: Extract<LeafBlock, { type: "continue" }>; ctx: BlockRenderCtx; state: RuntimeState }) {
  const blocked = (block.requiresBlockIds ?? []).some((id) => !state.completedBlocks.includes(id));
  return (
    <button
      disabled={blocked}
      onClick={() => ctx.onEvent(block.id, "click")}
      style={{ marginTop: 16, padding: "8px 20px" }}
    >
      {block.label ?? "Continue"}
    </button>
  );
}

function ComponentBlockView({ block }: { block: Extract<LeafBlock, { type: "component" }> }) {
  // Component library resolution (component_definitions) is authoring/editor
  // territory (Step 6+) — the runtime shows the override text it was given so
  // a spec referencing one doesn't crash the player, per Step 5's scope.
  return (
    <div style={{ ...box, borderStyle: "dashed" }}>
      {block.overrides?.title && <strong>{block.overrides.title}</strong>}
      {block.overrides?.text && renderRichText(block.overrides.text)}
    </div>
  );
}

// ------------------------------------------------------------- dispatch

export function renderBlock(block: LeafBlock, ctx: BlockRenderCtx): React.ReactNode {
  if (!isBlockVisible(ctx.state, block)) return null;

  const clickable = (block.triggers ?? []).some((t) => t.when === "click" && !t.onId);
  const wrap = (node: React.ReactNode) =>
    clickable ? (
      <div onClick={() => ctx.onEvent(block.id, "click")} data-runtime-state={currentBlockStateId(ctx.state, block.id)}>
        {node}
      </div>
    ) : (
      node
    );

  switch (block.type) {
    case "text":
      return wrap(<TextBlockView block={block} />);
    case "heading":
      return wrap(<HeadingBlockView block={block} />);
    case "list":
      return wrap(<ListBlockView block={block} />);
    case "quote":
      return wrap(<QuoteBlockView block={block} />);
    case "statement":
      return wrap(<StatementBlockView block={block} />);
    case "divider":
      return <DividerBlockView block={block} />;
    case "spacer":
      return <SpacerBlockView block={block} />;
    case "image":
      return wrap(<ImageBlockView block={block} />);
    case "imageGallery":
      return <ImageGalleryBlockView block={block} />;
    case "video":
      return <VideoBlockView block={block} ctx={ctx} />;
    case "audio":
      return <AudioBlockView block={block} ctx={ctx} />;
    case "embed":
      return <EmbedBlockView block={block} />;
    case "accordion":
      return <AccordionBlockView block={block} ctx={ctx} />;
    case "tabs":
      return <TabsBlockView block={block} ctx={ctx} />;
    case "flashcards":
      return <FlashcardsBlockView block={block} ctx={ctx} />;
    case "labeledGraphic":
      return <LabeledGraphicBlockView block={block} ctx={ctx} />;
    case "hotspot":
      return <HotspotBlockView block={block} ctx={ctx} state={ctx.state} />;
    case "process":
      return wrap(<ProcessBlockView block={block} />);
    case "sorting":
      return <SortingBlockView block={block} ctx={ctx} />;
    case "scenario":
      return <ScenarioBlockView block={block} ctx={ctx} />;
    case "knowledgeCheck":
      return <QuizLikeBlockView block={block} ctx={ctx} container="knowledgeCheck" />;
    case "quiz":
      return <QuizLikeBlockView block={block} ctx={ctx} container="quiz" />;
    case "continue":
      return <ContinueBlockView block={block} ctx={ctx} state={ctx.state} />;
    case "component":
      return <ComponentBlockView block={block} />;
    default:
      return null;
  }
}
