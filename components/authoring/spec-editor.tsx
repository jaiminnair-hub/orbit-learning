"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CourseSpecType as CourseSpec, LeafBlockType as LeafBlock } from "@/lib/spec";
import type { Finding } from "@/lib/spec";
import { RuntimeCoursePlayer } from "@/components/runtime/RuntimeCoursePlayer";
import {
  BLOCK_LABELS,
  createAssetBlock,
  createBlock,
  createPage,
  createSection,
  INSERTABLE_TYPES,
  type InsertableType,
} from "@/lib/authoring/block-factory";
import type { JsonPatchOp } from "@/lib/authoring/json-patch";
import { BlockInspector } from "./block-inspector";
import { TriggersEditor, VariablesEditor, pageTargets } from "./interaction-editor";
import { BlockTimelineTrackEditor, LayersEditor, PageLayoutEditor, TimelineEditor } from "./layers-timeline-editor";
import { ComponentPicker, MediaPicker } from "./media-picker";
import {
  dangerColor,
  eyebrowStyle,
  fieldStyle as inputStyle,
  iconBtnStyle,
  labelStyle,
  mutedTextStyle,
  panelStyle as panel,
  scopeHeadingStyle,
  selectedBackground,
  selectedBorder,
  tabButtonStyle,
} from "./theme";
import { TimelinePanel } from "./timeline-panel";

/**
 * The visual authoring engine (Phase 3 step 6).
 *
 * Edits are expressed as JSON-Patch operations against the stored document
 * rather than as whole-document saves — the server applies them with
 * optimistic concurrency, so two people editing the same course cannot
 * silently overwrite one another (docs/PHASE3_API_EVENTS.md §1).
 *
 * Preview mounts the *real* step 5 interpreter, deliberately. A second
 * rendering path built for the editor would drift from the one learners
 * actually get, and the drift would only ever be discovered after publish.
 */

type SaveState = "idle" | "saving" | "saved" | "conflict" | "invalid" | "error";

interface Props {
  specId: string;
}

const AUTOSAVE_MS = 700;

export function SpecEditor({ specId }: Props) {
  const [spec, setSpec] = useState<CourseSpec | null>(null);
  const [meta, setMeta] = useState<{ title: string; status: string; version: number; updatedAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sectionIndex, setSectionIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  // Named to match Storyline's own panels, per user request — each tab is
  // always the same content regardless of selection, unlike the old
  // "interactions" tab that silently swapped what it showed.
  const [tab, setTab] = useState<"block" | "layers" | "triggers" | "page" | "checks">("block");
  const [previewing, setPreviewing] = useState(false);

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [picker, setPicker] = useState<"media" | "component" | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const queue = useRef<JsonPatchOp[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updatedAt = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/v1/authoring/specs/${specId}`);
      const json = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(json.error?.message ?? "Could not load this course.");
        setLoading(false);
        return;
      }
      const row = json.data.spec;
      setSpec(row.spec as CourseSpec);
      setMeta({ title: row.title, status: row.status, version: row.version, updatedAt: row.updated_at });
      updatedAt.current = row.updated_at;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [specId]);

  const flush = useCallback(async () => {
    if (queue.current.length === 0) return;
    const patch = queue.current;
    queue.current = [];
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    setSaveState("saving");
    const res = await fetch(`/api/v1/authoring/specs/${specId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch, baseUpdatedAt: updatedAt.current }),
    }).catch(() => null);

    if (!res) {
      setSaveState("error");
      return;
    }
    const json = await res.json().catch(() => null);

    if (res.status === 409) {
      setSaveState("conflict");
      return;
    }
    if (res.status === 422) {
      setSaveState("invalid");
      setFindings(json?.error?.details?.findings ?? []);
      return;
    }
    if (!res.ok) {
      setSaveState("error");
      return;
    }

    updatedAt.current = json.data.spec.updated_at;
    setMeta((m) => (m ? { ...m, updatedAt: json.data.spec.updated_at, title: json.data.spec.title } : m));
    setFindings(json.data.validation?.findings ?? []);
    setSaveState("saved");
  }, [specId]);

  /**
   * Applies an edit locally and queues the matching patch.
   *
   * The optimistic local update is what keeps typing responsive; the queued
   * operation is what the server actually commits. They are produced together
   * so they cannot disagree about what changed.
   */
  const edit = useCallback(
    (next: CourseSpec, ops: JsonPatchOp[]) => {
      setSpec(next);
      queue.current.push(...ops);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    },
    [flush]
  );

  // An editor that loses the last edit on navigate-away is not an editor.
  useEffect(() => {
    const onHide = () => {
      if (queue.current.length === 0) return;
      const body = JSON.stringify({ patch: queue.current, baseUpdatedAt: updatedAt.current });
      queue.current = [];
      navigator.sendBeacon?.(`/api/v1/authoring/specs/${specId}`, new Blob([body], { type: "application/json" }));
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void flush();
    };
  }, [flush, specId]);

  const section = spec?.sections[sectionIndex];
  const page = section?.pages[pageIndex];

  const targets = useMemo(
    () => (spec && page ? pageTargets(spec, page) : { blocks: [], layers: [], pages: [], cuePoints: [] }),
    [spec, page]
  );
  const selectedBlock = page?.blocks.find((b) => b.id === selectedBlockId) ?? null;

  if (loading) return <p>Loading course…</p>;
  if (error || !spec || !meta) return <p style={{ color: dangerColor }}>{error ?? "Could not load this course."}</p>;

  const pagePath = `/sections/${sectionIndex}/pages/${pageIndex}`;
  const readOnly = meta.status === "published";

  // ---------------------------------------------------------- edit verbs

  function updateBlock(index: number, next: LeafBlock) {
    if (!spec) return;
    const copy = structuredClone(spec);
    copy.sections[sectionIndex].pages[pageIndex].blocks[index] = next as CourseSpec["sections"][0]["pages"][0]["blocks"][0];
    edit(copy, [{ op: "replace", path: `${pagePath}/blocks/${index}`, value: next }]);
  }

  function insertBlock(block: LeafBlock) {
    if (!spec) return;
    const copy = structuredClone(spec);
    copy.sections[sectionIndex].pages[pageIndex].blocks.push(block as CourseSpec["sections"][0]["pages"][0]["blocks"][0]);
    edit(copy, [{ op: "add", path: `${pagePath}/blocks/-`, value: block }]);
    setSelectedBlockId(block.id);
    setTab("block");
  }

  function addBlock(type: InsertableType) {
    insertBlock(createBlock(type));
  }

  function removeBlock(index: number) {
    if (!spec) return;
    const copy = structuredClone(spec);
    const [removed] = copy.sections[sectionIndex].pages[pageIndex].blocks.splice(index, 1);
    edit(copy, [{ op: "remove", path: `${pagePath}/blocks/${index}` }]);
    if (removed?.id === selectedBlockId) setSelectedBlockId(null);
  }

  function moveBlock(from: number, to: number) {
    if (!spec) return;
    const blocks = spec.sections[sectionIndex].pages[pageIndex].blocks;
    if (to < 0 || to >= blocks.length) return;
    const copy = structuredClone(spec);
    const list = copy.sections[sectionIndex].pages[pageIndex].blocks;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    edit(copy, [{ op: "move", from: `${pagePath}/blocks/${from}`, path: `${pagePath}/blocks/${to}` }]);
  }

  function addPage() {
    if (!spec) return;
    const newPage = createPage(`Page ${section!.pages.length + 1}`);
    const copy = structuredClone(spec);
    copy.sections[sectionIndex].pages.push(newPage);
    edit(copy, [{ op: "add", path: `/sections/${sectionIndex}/pages/-`, value: newPage }]);
    setPageIndex(section!.pages.length);
    setSelectedBlockId(null);
  }

  function addSection() {
    if (!spec) return;
    const newSection = createSection(`Section ${spec.sections.length + 1}`);
    const copy = structuredClone(spec);
    copy.sections.push(newSection);
    edit(copy, [{ op: "add", path: "/sections/-", value: newSection }]);
    setSectionIndex(spec.sections.length);
    setPageIndex(0);
    setSelectedBlockId(null);
  }

  function renamePage(title: string) {
    if (!spec) return;
    const copy = structuredClone(spec);
    copy.sections[sectionIndex].pages[pageIndex].title = title;
    edit(copy, [{ op: "replace", path: `${pagePath}/title`, value: title }]);
  }

  function renameSection(title: string) {
    if (!spec) return;
    const copy = structuredClone(spec);
    copy.sections[sectionIndex].title = title;
    edit(copy, [{ op: "replace", path: `/sections/${sectionIndex}/title`, value: title }]);
  }

  function deletePage() {
    if (!spec || section!.pages.length <= 1) return;
    const copy = structuredClone(spec);
    copy.sections[sectionIndex].pages.splice(pageIndex, 1);
    edit(copy, [{ op: "remove", path: pagePath }]);
    setPageIndex(Math.max(0, pageIndex - 1));
    setSelectedBlockId(null);
  }

  async function publish(status: string) {
    await flush();
    const res = await fetch(`/api/v1/authoring/specs/${specId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = await res.json();
    if (!res.ok) {
      setFindings(json.error?.details?.findings ?? []);
      setError(json.error?.message ?? "Could not change status.");
      return;
    }
    setError(null);
    setMeta((m) => (m ? { ...m, status: json.data.spec.status, version: json.data.spec.version } : m));
  }

  const a11yErrors = findings.filter((f) => f.kind === "accessibility" && f.severity === "error").length;
  const errorFindings = findings.filter((f) => f.severity === "error");
  const warningFindings = findings.filter((f) => f.severity === "warning");

  // -------------------------------------------------------------- render

  return (
    <div>
      {picker === "media" && (
        <MediaPicker
          onCancel={() => setPicker(null)}
          onPick={(type, assetId) => {
            setPicker(null);
            insertBlock(createAssetBlock(type, assetId));
          }}
        />
      )}
      {picker === "component" && (
        <ComponentPicker
          onCancel={() => setPicker(null)}
          onPick={(componentDefinitionId) => {
            setPicker(null);
            insertBlock(createBlock("component", { componentDefinitionId }));
          }}
        />
      )}

      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "1.15rem", flex: 1, fontFamily: "var(--font-display)", color: "var(--color-foreground)" }}>{meta.title}</h1>
        <span style={badge(meta.status)}>{meta.status} · v{meta.version}</span>
        <SaveIndicator state={saveState} />
        <button onClick={() => setPreviewing((p) => !p)}>{previewing ? "Back to editing" : "Preview"}</button>
        {meta.status === "draft" && <button onClick={() => publish("review")}>Send for review</button>}
        {meta.status === "review" && <button onClick={() => publish("approval")}>Send for approval</button>}
        {meta.status === "approval" && <button onClick={() => publish("published")}>Publish</button>}
      </header>

      {saveState === "conflict" && (
        <Banner tone="error">
          Someone else saved a change to this course. Reload to pick up their version — your unsaved edits will be lost.{" "}
          <button onClick={() => window.location.reload()}>Reload</button>
        </Banner>
      )}
      {saveState === "invalid" && <Banner tone="error">That change was rejected as invalid and was not saved.</Banner>}
      {saveState === "error" && <Banner tone="error">Could not save. Check your connection.</Banner>}
      {error && <Banner tone="error">{error}</Banner>}
      {readOnly && <Banner tone="info">Published courses are read-only. Duplicate it to make changes.</Banner>}

      {errorFindings.length > 0 && (
        <Banner tone="error">
          <strong>{errorFindings.length} problem(s) must be fixed before publishing:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {errorFindings.slice(0, 8).map((f, i) => (
              <li key={i} style={{ fontSize: ".8rem" }}>
                {f.message}
              </li>
            ))}
          </ul>
        </Banner>
      )}
      {errorFindings.length === 0 && warningFindings.length > 0 && (
        <Banner tone="warn">
          {warningFindings.length} suggestion(s), including accessibility. {warningFindings[0].message}
        </Banner>
      )}

      {previewing ? (
        <div style={panel}>
          <p style={{ ...mutedTextStyle, marginTop: 0 }}>This is the real learner runtime, playing the saved draft.</p>
          <RuntimeCoursePlayer specId={specId} preview />
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "240px 1fr 340px",
            gridTemplateRows: "minmax(0, 1fr) auto",
            gridTemplateAreas: '"scenes stage inspector" "scenes timeline inspector"',
            gap: 16,
          }}
        >
          {/* ------------------------------------------------ scenes & slides */}
          <nav style={{ ...panel, gridArea: "scenes" }}>
            <h2 style={eyebrowStyle}>Scenes &amp; Slides</h2>
            {spec.sections.map((s, si) => (
              <div key={s.id} style={{ marginBottom: 14 }}>
                <div style={{ ...eyebrowStyle, fontSize: ".68rem", margin: "0 0 4px" }}>{s.title}</div>
                {s.pages.map((p, pi) => {
                  const active = si === sectionIndex && pi === pageIndex;
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSectionIndex(si);
                        setPageIndex(pi);
                        setSelectedBlockId(null);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        textAlign: "left",
                        background: active ? selectedBackground : "transparent",
                        border: active ? selectedBorder : "1px solid transparent",
                        borderRadius: "var(--radius-sm)",
                        padding: "6px 8px",
                        marginBottom: 4,
                        cursor: "pointer",
                        fontSize: ".8rem",
                        color: "var(--color-foreground)",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 20,
                          height: 16,
                          flexShrink: 0,
                          borderRadius: "var(--radius-sm)",
                          background: "var(--color-border)",
                          fontSize: ".65rem",
                          fontWeight: 700,
                          color: "var(--color-muted-foreground)",
                        }}
                      >
                        {pi + 1}
                      </span>
                      {p.title}
                    </button>
                  );
                })}
              </div>
            ))}
            {!readOnly && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                <button onClick={addPage} style={{ fontSize: ".75rem" }}>+ Slide</button>
                <button onClick={addSection} style={{ fontSize: ".75rem" }}>+ Scene</button>
              </div>
            )}
          </nav>

          {/* -------------------------------------------------------- stage */}
          <section style={{ ...panel, gridArea: "stage", background: "var(--color-background)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <h2 style={eyebrowStyle}>Stage</h2>
              {page?.layout?.mode === "canvas" && (
                <span style={mutedTextStyle}>
                  {page.layout.width}×{page.layout.height}px · {page.layout.scaling ?? "fit"}
                </span>
              )}
            </div>
            {page ? (
              <div
                style={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "0 2px 10px color-mix(in oklch, var(--color-foreground) 8%, transparent)",
                  padding: 16,
                }}
              >
                <input
                  value={page.title}
                  disabled={readOnly}
                  onChange={(e) => renamePage(e.target.value)}
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "1rem",
                    fontWeight: 600,
                    border: "none",
                    borderBottom: "1px solid var(--color-border)",
                    width: "100%",
                    padding: "4px 0",
                    marginBottom: 12,
                    background: "transparent",
                    color: "var(--color-foreground)",
                  }}
                />

                {page.blocks.length === 0 && <p style={mutedTextStyle}>This slide is empty. Add a block below.</p>}

                {page.blocks.map((block, i) => (
                  <div
                    key={block.id}
                    draggable={!readOnly}
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => {
                      if (dragIndex === null || dragIndex === i) return;
                      e.preventDefault(); // required, or the drop is refused
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null && dragIndex !== i) moveBlock(dragIndex, i);
                      setDragIndex(null);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    style={{
                      border: block.id === selectedBlockId ? selectedBorder : "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                      padding: 10,
                      marginBottom: 8,
                      background: block.id === selectedBlockId ? selectedBackground : "var(--color-card)",
                      opacity: dragIndex === i ? 0.4 : 1,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {!readOnly && (
                        <span title="Drag to reorder" style={{ cursor: "grab", color: "var(--color-muted-foreground)", fontSize: ".9rem" }}>
                          ⠿
                        </span>
                      )}
                      {/* A real button, not a clickable card: selecting a block
                          has to be reachable by keyboard and announce itself,
                          which a div with onClick does neither of. */}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBlockId(block.id);
                          setTab("block");
                        }}
                        aria-label={`Edit ${BLOCK_LABELS[block.type] ?? block.type} block`}
                        aria-pressed={block.id === selectedBlockId}
                        style={{
                          flex: 1,
                          textAlign: "left",
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          fontSize: ".75rem",
                          fontWeight: 700,
                          color: "var(--color-muted-foreground)",
                        }}
                      >
                        {BLOCK_LABELS[block.type] ?? block.type}
                      </button>
                      {!readOnly && (
                        <>
                          {/* Keyboard-reachable equivalents of the drag gesture —
                              a reorder that only works with a mouse is not one. */}
                          <button title="Move up" aria-label={`Move ${BLOCK_LABELS[block.type] ?? block.type} up`} disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveBlock(i, i - 1); }} style={iconBtnStyle}>↑</button>
                          <button title="Move down" aria-label={`Move ${BLOCK_LABELS[block.type] ?? block.type} down`} disabled={i === page.blocks.length - 1} onClick={(e) => { e.stopPropagation(); moveBlock(i, i + 1); }} style={iconBtnStyle}>↓</button>
                          <button title="Delete" aria-label={`Delete ${BLOCK_LABELS[block.type] ?? block.type}`} onClick={(e) => { e.stopPropagation(); removeBlock(i); }} style={{ ...iconBtnStyle, color: dangerColor }}>✕</button>
                        </>
                      )}
                    </div>
                    <BlockSummary block={block} />
                  </div>
                ))}

                {!readOnly && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: "pointer", fontSize: ".85rem", fontWeight: 600, color: "var(--color-foreground)" }}>+ Add a block</summary>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {INSERTABLE_TYPES.map((type) => (
                        <button key={type} onClick={() => addBlock(type)} style={{ fontSize: ".75rem" }}>
                          {BLOCK_LABELS[type] ?? type}
                        </button>
                      ))}
                      {/* Media and saved blocks need a choice made first, so
                          they open a picker instead of inserting blind. */}
                      <button onClick={() => setPicker("media")} style={{ fontSize: ".75rem" }}>
                        Media…
                      </button>
                      <button onClick={() => setPicker("component")} style={{ fontSize: ".75rem" }}>
                        Saved block…
                      </button>
                    </div>
                  </details>
                )}

                {!readOnly && section!.pages.length > 1 && (
                  <button onClick={deletePage} style={{ marginTop: 16, fontSize: ".75rem", color: dangerColor }}>
                    Delete this slide
                  </button>
                )}
              </div>
            ) : (
              <p>Select a slide.</p>
            )}
          </section>

          {/* ----------------------------------------------------- timeline */}
          <section style={{ ...panel, gridArea: "timeline" }}>
            {page ? (
              <TimelinePanel
                page={page}
                selectedBlockId={selectedBlockId}
                onSelectBlock={(id) => {
                  setSelectedBlockId(id);
                  setTab("block");
                }}
              />
            ) : (
              <p style={mutedTextStyle}>Select a slide.</p>
            )}
          </section>

          {/* ----------------------------------------------------- inspector */}
          <aside style={{ ...panel, gridArea: "inspector" }}>
            <h2 style={scopeHeadingStyle}>
              {selectedBlock ? BLOCK_LABELS[selectedBlock.type] ?? selectedBlock.type : `Page: ${page?.title ?? ""}`}
            </h2>

            <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
              {(["block", "layers", "triggers", "page", "checks"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} style={tabButtonStyle(tab === t)}>
                  {t === "checks" && a11yErrors > 0 ? `Checks (${a11yErrors})` : TAB_LABELS[t]}
                </button>
              ))}
            </div>

            <fieldset disabled={readOnly} style={{ border: "none", padding: 0, margin: 0 }}>
              {tab === "block" &&
                (selectedBlock ? (
                  <>
                    {selectedBlock.provenance && <GenerationProvenance provenance={selectedBlock.provenance} />}
                    <BlockInspector
                      block={selectedBlock}
                      isCanvas={page!.layout?.mode === "canvas"}
                      onChange={(next) => {
                        const index = page!.blocks.findIndex((b) => b.id === selectedBlock.id);
                        if (index >= 0) updateBlock(index, next);
                      }}
                    />
                  </>
                ) : (
                  <p style={mutedTextStyle}>Select a block on the Stage to edit it.</p>
                ))}

              {tab === "layers" &&
                (selectedBlock && page ? (
                  <>
                    <LayersEditor
                      layers={page.blocks.find((b) => b.id === selectedBlock.id)?.layers ?? []}
                      onChange={(layers) => {
                        const copy = structuredClone(spec);
                        const index = page.blocks.findIndex((b) => b.id === selectedBlock.id);
                        copy.sections[sectionIndex].pages[pageIndex].blocks[index].layers = layers;
                        edit(copy, [
                          { op: "replace", path: `${pagePath}/blocks/${index}`, value: copy.sections[sectionIndex].pages[pageIndex].blocks[index] },
                        ]);
                      }}
                    />
                    {page.timeline && (
                      <BlockTimelineTrackEditor
                        timeline={page.timeline}
                        blockId={selectedBlock.id}
                        onChange={(timeline) => {
                          const copy = structuredClone(spec);
                          copy.sections[sectionIndex].pages[pageIndex].timeline = timeline;
                          edit(copy, [{ op: "replace", path: `${pagePath}/timeline`, value: timeline }]);
                        }}
                      />
                    )}
                  </>
                ) : (
                  <p style={mutedTextStyle}>Select a block to add layers or schedule its animation.</p>
                ))}

              {tab === "triggers" && page && (
                <>
                  <VariablesEditor
                    variables={spec.variables ?? []}
                    onChange={(variables) => {
                      const copy = structuredClone(spec);
                      copy.variables = variables;
                      edit(copy, [
                        spec.variables === undefined
                          ? { op: "add", path: "/variables", value: variables }
                          : { op: "replace", path: "/variables", value: variables },
                      ]);
                    }}
                  />
                  <TriggersEditor
                    scopeLabel={selectedBlock ? `on ${BLOCK_LABELS[selectedBlock.type] ?? selectedBlock.type}` : "on this page"}
                    triggers={(selectedBlock ? selectedBlock.triggers : page.triggers) ?? []}
                    targets={targets}
                    variables={spec.variables ?? []}
                    onChange={(triggers) => {
                      const copy = structuredClone(spec);
                      if (selectedBlock) {
                        const index = page.blocks.findIndex((b) => b.id === selectedBlock.id);
                        copy.sections[sectionIndex].pages[pageIndex].blocks[index].triggers = triggers;
                        edit(copy, [{ op: "replace", path: `${pagePath}/blocks/${index}`, value: copy.sections[sectionIndex].pages[pageIndex].blocks[index] }]);
                      } else {
                        copy.sections[sectionIndex].pages[pageIndex].triggers = triggers;
                        edit(copy, [
                          page.triggers === undefined
                            ? { op: "add", path: `${pagePath}/triggers`, value: triggers }
                            : { op: "replace", path: `${pagePath}/triggers`, value: triggers },
                        ]);
                      }
                    }}
                  />
                </>
              )}

              {tab === "page" && page && (
                <>
                  <PageLayoutEditor
                    page={page}
                    onChange={(layout) => {
                      const copy = structuredClone(spec);
                      const target = copy.sections[sectionIndex].pages[pageIndex];
                      const had = target.layout !== undefined;
                      if (layout) target.layout = layout;
                      else delete target.layout;
                      edit(copy, [
                        layout
                          ? had
                            ? { op: "replace", path: `${pagePath}/layout`, value: layout }
                            : { op: "add", path: `${pagePath}/layout`, value: layout }
                          : { op: "remove", path: `${pagePath}/layout` },
                      ]);
                    }}
                  />
                  <TimelineEditor
                    page={page}
                    onChange={(timeline) => {
                      const copy = structuredClone(spec);
                      const target = copy.sections[sectionIndex].pages[pageIndex];
                      const had = target.timeline !== undefined;
                      if (timeline) target.timeline = timeline;
                      else delete target.timeline;
                      edit(copy, [
                        timeline
                          ? had
                            ? { op: "replace", path: `${pagePath}/timeline`, value: timeline }
                            : { op: "add", path: `${pagePath}/timeline`, value: timeline }
                          : { op: "remove", path: `${pagePath}/timeline` },
                      ]);
                    }}
                  />
                  <hr style={{ margin: "16px 0", border: 0, borderTop: "1px solid var(--color-border)" }} />
                  <CourseSettings
                    spec={spec}
                    sectionTitle={section!.title}
                    onRenameSection={renameSection}
                    onChange={(next, ops) => edit(next, ops)}
                  />
                </>
              )}

              {tab === "checks" && (
                <AccessibilityPanel
                  findings={findings}
                  profile={spec.meta.accessibilityProfile ?? "wcag-2.2-aa"}
                  onProfileChange={(profile) => {
                    const copy = structuredClone(spec);
                    copy.meta.accessibilityProfile = profile;
                    edit(copy, [
                      spec.meta.accessibilityProfile === undefined
                        ? { op: "add", path: "/meta/accessibilityProfile", value: profile }
                        : { op: "replace", path: "/meta/accessibilityProfile", value: profile },
                    ]);
                  }}
                  onGoTo={(f) => {
                    // Deep-link: findings are path-addressed precisely so the
                    // editor can put the author in front of the problem
                    // rather than describing where it is.
                    if (!f.pageId) return;
                    for (const [si, s] of spec.sections.entries()) {
                      const pi = s.pages.findIndex((p) => p.id === f.pageId);
                      if (pi >= 0) {
                        setSectionIndex(si);
                        setPageIndex(pi);
                        if (f.blockId) {
                          setSelectedBlockId(f.blockId);
                          setTab("block");
                        }
                        return;
                      }
                    }
                  }}
                />
              )}
            </fieldset>
          </aside>
        </div>
      )}
    </div>
  );
}

const TAB_LABELS = {
  block: "Block",
  layers: "Layers",
  triggers: "Triggers",
  page: "Page",
  checks: "Checks",
} as const;

/**
 * AI content remains editable like any other block, but it must never become
 * indistinguishable from authored copy. This small review card gives an
 * author the job and timestamp behind the selected block before they decide
 * whether to keep, revise, or remove it.
 */
function GenerationProvenance({
  provenance,
}: {
  provenance: { jobId?: string; stepName?: string; sourceAssetId?: string; sourceRef?: string; generatedAt?: string };
}) {
  return (
    <section className="authoring-provenance" aria-label="AI generation details">
      <p>AI-generated content</p>
      <span>{provenance.stepName ? `Step: ${provenance.stepName}` : "Generated during course creation"}</span>
      {provenance.generatedAt && <span>Created: {new Date(provenance.generatedAt).toLocaleString()}</span>}
      {provenance.sourceRef && <span>Source reference: {provenance.sourceRef}</span>}
      {provenance.sourceAssetId && <span>Library source attached</span>}
      <small>Review this block against the source material before publishing. You can edit or delete it normally.</small>
    </section>
  );
}

/**
 * The accessibility surface for the editor.
 *
 * Lists what the gate found, says plainly which entries block publishing, and
 * lets the author click straight to the offending block — findings are
 * path-addressed precisely so this is possible. Also exposes the profile,
 * because opting a course down to `none` should be a visible, deliberate act
 * with its consequence stated, not a hidden field.
 */
function AccessibilityPanel({
  findings,
  profile,
  onProfileChange,
  onGoTo,
}: {
  findings: Finding[];
  profile: "wcag-2.2-aa" | "wcag-2.2-a" | "none";
  onProfileChange: (p: "wcag-2.2-aa" | "wcag-2.2-a" | "none") => void;
  onGoTo: (f: Finding) => void;
}) {
  const a11y = findings.filter((f) => f.kind === "accessibility");
  const errors = a11y.filter((f) => f.severity === "error");
  const rest = a11y.filter((f) => f.severity !== "error");

  return (
    <div>
      <label style={{ display: "block" }}>
        <span style={labelStyle}>Standard this course is held to</span>
        <select
          style={inputStyle}
          value={profile}
          onChange={(e) => onProfileChange(e.target.value as "wcag-2.2-aa" | "wcag-2.2-a" | "none")}
        >
          <option value="wcag-2.2-aa">WCAG 2.2 AA (recommended)</option>
          <option value="wcag-2.2-a">WCAG 2.2 A</option>
          <option value="none">Not enforced</option>
        </select>
      </label>
      {profile === "none" && (
        <p style={{ fontSize: ".75rem", color: "var(--color-warning)", marginTop: 6 }}>
          Problems are still reported, but none of them will stop this course being published.
        </p>
      )}

      <hr style={{ margin: "16px 0", border: 0, borderTop: "1px solid var(--color-border)" }} />

      {a11y.length === 0 ? (
        <p style={{ fontSize: ".85rem", color: "var(--color-success)" }}>No accessibility problems found.</p>
      ) : (
        <>
          {errors.length > 0 && (
            <>
              <h4 style={{ margin: "0 0 6px", fontSize: ".8rem", color: dangerColor }}>
                {errors.length} must be fixed before publishing
              </h4>
              {errors.map((f, i) => (
                <FindingRow key={`e${i}`} finding={f} tone="error" onGoTo={onGoTo} />
              ))}
            </>
          )}
          {rest.length > 0 && (
            <>
              <h4 style={{ margin: "14px 0 6px", fontSize: ".8rem", color: "var(--color-warning)" }}>
                {rest.length} suggestion{rest.length === 1 ? "" : "s"}
              </h4>
              {rest.map((f, i) => (
                <FindingRow key={`w${i}`} finding={f} tone="warn" onGoTo={onGoTo} />
              ))}
            </>
          )}
        </>
      )}

      <p style={{ ...mutedTextStyle, fontSize: ".72rem", marginTop: 16 }}>Checked whenever the course is saved.</p>
    </div>
  );
}

function FindingRow({
  finding,
  tone,
  onGoTo,
}: {
  finding: Finding;
  tone: "error" | "warn";
  onGoTo: (f: Finding) => void;
}) {
  const toneColor = tone === "error" ? dangerColor : "var(--color-warning)";
  return (
    <button
      type="button"
      onClick={() => onGoTo(finding)}
      disabled={!finding.pageId}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: `color-mix(in oklch, ${toneColor} 10%, var(--color-card))`,
        border: "none",
        borderLeft: `3px solid ${toneColor}`,
        borderRadius: "var(--radius-sm)",
        padding: "7px 9px",
        marginBottom: 5,
        cursor: finding.pageId ? "pointer" : "default",
        fontSize: ".78rem",
        lineHeight: 1.4,
        color: "var(--color-foreground)",
      }}
    >
      {finding.message}
      {finding.pageId && <span style={{ display: "block", ...mutedTextStyle, fontSize: ".72rem", marginTop: 3 }}>Go to block →</span>}
    </button>
  );
}

function CourseSettings({
  spec,
  sectionTitle,
  onRenameSection,
  onChange,
}: {
  spec: CourseSpec;
  sectionTitle: string;
  onRenameSection: (t: string) => void;
  onChange: (next: CourseSpec, ops: JsonPatchOp[]) => void;
}) {
  const completion = spec.completion ?? { rule: "allPagesVisited" as const };
  const quizBlocks = spec.sections.flatMap((s) =>
    s.pages.flatMap((p) => p.blocks.filter((b) => b.type === "quiz").map((b) => ({ id: b.id, page: p.title })))
  );

  return (
    <div>
      <label style={{ display: "block" }}>
        <span style={labelStyle}>Course title</span>
        <input
          style={inputStyle}
          value={spec.meta.title}
          onChange={(e) => {
            const copy = structuredClone(spec);
            copy.meta.title = e.target.value;
            onChange(copy, [{ op: "replace", path: "/meta/title", value: e.target.value }]);
          }}
        />
      </label>

      <label style={{ display: "block", marginTop: 12 }}>
        <span style={labelStyle}>Current section title</span>
        <input style={inputStyle} value={sectionTitle} onChange={(e) => onRenameSection(e.target.value)} />
      </label>

      <label style={{ display: "block", marginTop: 12 }}>
        <span style={labelStyle}>Course is complete when</span>
        <select
          style={inputStyle}
          value={completion.rule}
          onChange={(e) => {
            const rule = e.target.value as NonNullable<CourseSpec["completion"]>["rule"];
            const copy = structuredClone(spec);
            copy.completion = rule === "passedQuiz" ? { rule, quizBlockId: quizBlocks[0]?.id } : { rule };
            onChange(copy, [
              spec.completion === undefined
                ? { op: "add", path: "/completion", value: copy.completion }
                : { op: "replace", path: "/completion", value: copy.completion },
            ]);
          }}
        >
          <option value="allPagesVisited">Every page has been visited</option>
          <option value="allBlocksComplete">Every block is complete</option>
          <option value="passedQuiz">A quiz is passed</option>
          <option value="manual">A trigger marks it complete</option>
        </select>
      </label>

      {completion.rule === "passedQuiz" && (
        <label style={{ display: "block", marginTop: 12 }}>
          <span style={labelStyle}>Which quiz</span>
          <select
            style={inputStyle}
            value={completion.quizBlockId ?? ""}
            onChange={(e) => {
              const copy = structuredClone(spec);
              copy.completion = { ...completion, quizBlockId: e.target.value };
              onChange(copy, [{ op: "replace", path: "/completion", value: copy.completion }]);
            }}
          >
            {quizBlocks.length === 0 && <option value="">(add a quiz block first)</option>}
            {quizBlocks.map((q) => (
              <option key={q.id} value={q.id}>
                {q.page} · {q.id}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function BlockSummary({ block }: { block: LeafBlock }) {
  const text = summarise(block);
  return <div style={{ fontSize: ".85rem", color: "var(--color-foreground)", marginTop: 4 }}>{text}</div>;
}

function summarise(block: LeafBlock): string {
  switch (block.type) {
    case "heading":
      return block.text;
    case "text":
    case "quote":
    case "statement":
      return block.content.blocks[0]?.spans.map((s) => s.text).join("") || "(empty)";
    case "list":
      return `${block.items.length} item(s)`;
    case "accordion":
      return block.items.map((i) => i.title).join(" · ");
    case "tabs":
      return block.tabs.map((t) => t.label).join(" · ");
    case "flashcards":
      return `${block.cards.length} card(s)`;
    case "process":
      return block.steps.map((s) => s.title).join(" → ");
    case "sorting":
      return `${block.cards.length} cards into ${block.categories.length} categories`;
    case "scenario":
      return `${block.steps.length} step scenario`;
    case "quiz":
    case "knowledgeCheck":
      return `${block.items.length} question(s)`;
    case "continue":
      return block.label ?? "Continue";
    case "embed":
      return `${block.provider}: ${block.resourceId || "(no resource yet)"}`;
    case "image":
    case "video":
    case "audio":
    case "labeledGraphic":
    case "hotspot":
      return block.a11y?.altText || "(media)";
    default:
      return "";
  }
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, { text: string; color: string }> = {
    idle: { text: "", color: "var(--color-muted-foreground)" },
    saving: { text: "Saving…", color: "var(--color-muted-foreground)" },
    saved: { text: "All changes saved", color: "var(--color-success)" },
    conflict: { text: "Conflict", color: dangerColor },
    invalid: { text: "Not saved", color: dangerColor },
    error: { text: "Save failed", color: dangerColor },
  };
  const { text, color } = map[state];
  return <span style={{ fontSize: ".75rem", color, minWidth: 110 }}>{text}</span>;
}

function Banner({ tone, children }: { tone: "error" | "warn" | "info"; children: React.ReactNode }) {
  const fg = tone === "error" ? dangerColor : tone === "warn" ? "var(--color-warning)" : "var(--accent-secondary)";
  const bg = `color-mix(in oklch, ${fg} 10%, var(--color-card))`;
  return (
    <div style={{ background: bg, color: fg, padding: 10, borderRadius: "var(--radius-md)", marginBottom: 12, fontSize: ".85rem" }}>
      {children}
    </div>
  );
}

function badge(status: string): React.CSSProperties {
  const colors: Record<string, string> = {
    draft: "var(--color-muted-foreground)",
    review: "var(--color-warning)",
    approval: "var(--accent-secondary)",
    published: "var(--color-success)",
    archived: "var(--color-muted-foreground)",
  };
  return {
    fontSize: ".72rem",
    padding: "3px 8px",
    borderRadius: "var(--radius-full)",
    background: "var(--color-muted)",
    color: colors[status] ?? "var(--color-muted-foreground)",
    fontWeight: 600,
  };
}
