"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LeafBlockType as LeafBlock } from "@/lib/spec";
import type { CanvasLayout, CourseSpecType as CourseSpec } from "@/lib/spec";
import { animationStyle, computeBlockAnimationState } from "@/lib/runtime/animation";
import { canvasBackgroundStyle, canvasFrameStyle, positionStyle } from "@/lib/runtime/canvas";
import { closeLayer, currentPage, enterPage, fireBlockEvent, firePageEvent, firstPageId, initRuntimeState, submitQuiz } from "@/lib/runtime/engine";
import { fromPersisted, toPersisted, type PersistedRuntimeRow, type RuntimeEffects, type RuntimeState } from "@/lib/runtime/types";
import { useAssetUrl } from "@/lib/runtime/use-asset-url";
import { buildStatement } from "@/lib/runtime/xapi";
import { renderBlock, type BlockRenderCtx } from "./block-renderers";

/**
 * The canvas-mode page frame (Phase 3B, Track 2 step 1) — isolated as its own
 * component only so `useAssetUrl` (for the background image) can be called
 * unconditionally, per the rules of hooks, regardless of whether the current
 * page is even in canvas mode.
 */
function CanvasFrame({ layout, children }: { layout: CanvasLayout; children: React.ReactNode }) {
  const imageUrl = useAssetUrl(layout.background?.imageAssetId);
  return <div style={{ ...canvasFrameStyle(layout), ...canvasBackgroundStyle(layout, imageUrl ?? undefined) }}>{children}</div>;
}

/**
 * The native player for `source = 'authored'` learning objects — the
 * runtime interpreter (lib/runtime/engine.ts) wired to fetch/persist state
 * over the three routes from docs/PHASE3_API_EVENTS.md §5, and to the block
 * renderers for the current page. Mounted by
 * app/(app)/courses/[id]/player.tsx as a third branch alongside the
 * existing SCORM and asset paths — neither of those paths changes.
 */

interface Props {
  specId: string;
  onComplete?: () => void;
  /** Lets the enclosing course player give Orbit Guide the exact active page. */
  onPageContextChange?: (page: { pageId: string; pageTitle: string } | null) => void;
  /**
   * Authoring preview. Only a draft needs it, and the runtime route honours
   * it only for an org_admin — a learner adding the flag still gets a 403
   * (docs/PHASE3_API_EVENTS.md §5), so passing it here cannot widen access.
   */
  preview?: boolean;
}

/**
 * Autosave debounce. Batched rather than per-event so a learner clicking
 * through an interaction doesn't generate a write per click — but see
 * `flushNow`: anything still pending is forced out before the page can go
 * away, so the debounce never costs a learner their position.
 */
const AUTOSAVE_DEBOUNCE_MS = 800;

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};
const modalContentStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 8,
  padding: 24,
  maxWidth: 560,
  width: "90%",
  maxHeight: "80vh",
  overflow: "auto",
};

export function RuntimeCoursePlayer({ specId, onComplete, onPageContextChange, preview = false }: Props) {
  const [spec, setSpec] = useState<CourseSpec | null>(null);
  const [state, setState] = useState<RuntimeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const registrationRef = useRef<string>(crypto.randomUUID());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<Record<string, unknown> | null>(null);

  /**
   * Writes any pending state immediately.
   *
   * `leaving` selects the transport, and the distinction is load-bearing: a
   * learner who advances a page and then leaves inside the debounce window
   * must not lose the position they just reached, and resume that depends on
   * idling for 800ms first is not resume.
   *
   * On the way out that means `navigator.sendBeacon`, not `fetch`.
   * `keepalive` is specified to survive unload, but was measured being
   * dropped here under exactly that condition — the request left the page and
   * no response or row ever followed. sendBeacon is the transport browsers
   * actually guarantee for this; it is POST-only, which is why the state
   * route accepts POST as a beacon alias.
   */
  const flushNow = useCallback(
    (leaving = false) => {
      const payload = pendingSave.current;
      if (!payload) return;
      pendingSave.current = null;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }

      const url = `/api/v1/runtime/courses/${specId}/state`;
      const body = JSON.stringify(payload);

      if (leaving && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const queued = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        if (queued) return;
        // Falls through to fetch when the beacon queue is over quota.
      }

      void fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: leaving,
      }).catch(() => {});
    },
    [specId]
  );

  useEffect(() => {
    const onPageHide = () => flushNow(true);
    const onVisibilityChange = () => {
      // `pagehide` alone misses the mobile case, where a backgrounded tab may
      // be discarded without ever firing it.
      if (document.visibilityState === "hidden") flushNow(true);
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // Unmounting counts too: the learner may simply have picked a
      // different learning object in the course outline.
      flushNow(true);
    };
  }, [flushNow]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [specRes, stateRes] = await Promise.all([
        fetch(`/api/v1/runtime/courses/${specId}${preview ? "?preview=true" : ""}`),
        fetch(`/api/v1/runtime/courses/${specId}/state`),
      ]);
      const specJson = await specRes.json();
      if (cancelled) return;

      if (!specRes.ok) {
        setError(specJson.error?.message ?? "Could not load this course.");
        setLoading(false);
        return;
      }

      const loadedSpec = specJson.data.spec as CourseSpec;
      setSpec(loadedSpec);

      const stateJson = stateRes.ok ? await stateRes.json() : null;
      const row = stateJson?.data?.state as PersistedRuntimeRow | null | undefined;

      if (row?.current_page_id) {
        setState(fromPersisted(row));
      } else {
        const first = firstPageId(loadedSpec);
        const fresh = initRuntimeState(loadedSpec);
        if (first) {
          const { state: entered, effects } = enterPage(loadedSpec, fresh, first);
          effects.xapi.unshift({ verb: "initialized" });
          setState(entered);
          void postXapi(effects, loadedSpec);
          persist(entered);
        } else {
          setState(fresh);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-runs only on specId; onComplete/preview are stable per mount.
  }, [specId]);

  /**
   * A page's `Timeline` — cue points and `durationMs` — was authorable
   * (`layers-timeline-editor.tsx`) well before anything actually interpreted
   * it: `lib/runtime/engine.ts` had zero references to `Timeline`/`CuePoint`
   * anywhere, so a cue point never fired regardless of what an author set up.
   * This is that missing half: a local, unpersisted clock (matching the
   * existing "Step 5 does not persist mid-timeline position" stance) that
   * starts on page entry when `timeline.autoplay` is set, advances while
   * `playing`, and fires `timelineCue`/`timelineComplete` through the engine
   * exactly like any other event once its time is reached. `playTimeline`/
   * `pauseTimeline` actions (wired in the engine to set
   * `effects.timelineControl`) toggle `playing` for a non-autoplay timeline.
   */
  const stateRef = useRef<RuntimeState | null>(null);
  stateRef.current = state;
  const timelineRef = useRef<{ elapsedMs: number; playing: boolean; firedCueIds: Set<string>; completedFired: boolean }>({
    elapsedMs: 0,
    playing: false,
    firedCueIds: new Set(),
    completedFired: false,
  });
  // Forces a re-render on ticks that only move animation-effect timing along
  // (no cue/completion fired, which would already re-render via setState).
  // Only used when the page actually has tracks to animate — a plain
  // cue-point timeline has nothing that needs a mid-tick re-render.
  const [, setAnimationTick] = useState(0);

  useEffect(() => {
    if (!spec || !state) {
      onPageContextChange?.(null);
      return;
    }
    const activePage = currentPage(spec, state);
    onPageContextChange?.(activePage ? { pageId: activePage.id, pageTitle: activePage.title } : null);
  }, [onPageContextChange, spec, state]);

  useEffect(() => {
    if (!spec || !state) return;
    const page = currentPage(spec, state);
    const timeline = page?.timeline;
    timelineRef.current = { elapsedMs: 0, playing: !!timeline?.autoplay, firedCueIds: new Set(), completedFired: false };
    if (!timeline) return;

    const hasTracks = !!timeline.tracks?.length;
    const TICK_MS = 200;
    const interval = setInterval(() => {
      const t = timelineRef.current;
      if (!t.playing) return;
      t.elapsedMs += TICK_MS;

      let firedSomething = false;
      for (const cue of timeline.cuePoints ?? []) {
        if (t.elapsedMs >= cue.atMs && !t.firedCueIds.has(cue.id)) {
          t.firedCueIds.add(cue.id);
          const current = stateRef.current;
          if (current) applyResult(firePageEvent(spec, current, "timelineCue", cue.id));
          firedSomething = true;
        }
      }
      if (!t.completedFired && t.elapsedMs >= timeline.durationMs) {
        t.completedFired = true;
        const current = stateRef.current;
        if (current) applyResult(firePageEvent(spec, current, "timelineComplete"));
        firedSomething = true;
      }
      // A fired cue/completion already re-renders via applyResult's setState;
      // this covers every other tick, which is the only way an animation's
      // appear/disappear/active-preset window is ever noticed.
      if (hasTracks && !firedSomething) setAnimationTick((n) => n + 1);
    }, TICK_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-runs only when the page changes; reads fresh state via stateRef inside the tick.
  }, [spec, state?.currentPageId]);

  async function postXapi(effects: RuntimeEffects, activeSpec: CourseSpec) {
    if (!effects.xapi.length) return;
    const statements = effects.xapi.map((e) =>
      buildStatement(e, { specId, specTitle: activeSpec.meta.title, registration: registrationRef.current })
    );
    try {
      await fetch("/api/v1/runtime/xapi/statements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statements }),
      });
    } catch {
      // Best-effort telemetry — a dropped statement must not block playback.
    }
  }

  function persist(next: RuntimeState, immediate = false) {
    pendingSave.current = { ...toPersisted(next), completed: !!next.completedAt };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (immediate) flushNow();
    else saveTimer.current = setTimeout(() => flushNow(), AUTOSAVE_DEBOUNCE_MS);
  }

  function applyResult(result: { state: RuntimeState; effects: RuntimeEffects }) {
    if (!spec) return;
    setState(result.state);
    void postXapi(result.effects, spec);
    persist(result.state, !!result.effects.courseCompleted);
    if (result.effects.courseCompleted) onComplete?.();
    if (result.effects.timelineControl) {
      timelineRef.current.playing = result.effects.timelineControl === "play";
    }
  }

  if (loading) return <p>Loading course…</p>;
  if (error || !spec || !state) return <p style={{ color: "#b23a3a" }}>{error ?? "Could not load this course."}</p>;

  const page = currentPage(spec, state);
  if (!page) return <p style={{ color: "#b23a3a" }}>This course has no playable content yet.</p>;

  const allPages = spec.sections.flatMap((s) => s.pages);
  const menuPages = allPages.filter((p) => !p.hiddenFromMenu);
  const currentIndex = allPages.findIndex((p) => p.id === page.id);
  const nextPage = currentIndex >= 0 ? allPages[currentIndex + 1] : undefined;
  const showMenu = spec.navigation?.showMenu !== false && menuPages.length > 1;
  // Pages already render their title as the learner-facing heading. Course
  // Builder Lite's first generated block can legitimately repeat that exact
  // title, so suppress only that first duplicate — never a later heading the
  // author deliberately added for structure.
  const displayBlocks = page.blocks.filter(
    (block, index) => !(index === 0 && block.type === "heading" && block.text.trim().toLocaleLowerCase() === page.title.trim().toLocaleLowerCase())
  );

  const ctx: BlockRenderCtx = {
    state,
    onEvent: (blockId: string, when: Parameters<typeof fireBlockEvent>[3], onId?: string) =>
      applyResult(fireBlockEvent(spec, state, blockId, when, onId)),
    onSubmitQuiz: (blockId: string, answers: Record<string, unknown>) => applyResult(submitQuiz(spec, state, blockId, answers)),
  };

  const goToPage = (pageId: string) => applyResult(enterPage(spec, state, pageId));

  // A plain local rather than `page.layout` inline at each use site — TypeScript's
  // narrowing of a discriminant behind optional chaining doesn't survive being
  // re-read inside a nested closure (e.g. a .map() callback).
  const canvasLayout: CanvasLayout | undefined = page.layout?.mode === "canvas" ? page.layout : undefined;

  const trackByBlockId = new Map((page.timeline?.tracks ?? []).map((t) => [t.blockId, t]));

  /**
   * Resolves a block's timing (visibility + any active animation, Track 1
   * step 2) without deciding how it's positioned — a canvas-positioned block
   * and a flow block share this same timing logic but need different wrapper
   * styles, so the caller applies position separately.
   */
  const resolveTimedBlock = (block: LeafBlock): { key: string; rendered: React.ReactNode; style: React.CSSProperties } | null => {
    if (!page.timeline) {
      const rendered = renderBlock(block, ctx);
      return rendered === null ? null : { key: block.id, rendered, style: {} };
    }
    const { visible, active } = computeBlockAnimationState(trackByBlockId.get(block.id), timelineRef.current.elapsedMs);
    if (!visible) return null;
    const rendered = renderBlock(block, ctx);
    if (rendered === null) return null; // hidden via a trigger's showBlock/hideBlock, independent of the timeline
    if (!active) return { key: block.id, rendered, style: {} };
    return { key: `${block.id}:${active.id}`, rendered, style: animationStyle(active, timelineRef.current.playing) };
  };

  const renderTimedBlock = (block: LeafBlock) => {
    const t = resolveTimedBlock(block);
    if (!t) return null;
    return (
      <div key={t.key} style={t.style}>
        {t.rendered}
      </div>
    );
  };

  /**
   * A canvas-positioned block's animation and its absolute position share one
   * wrapping div. Note: a `Position.rotation` and a slide/zoom/spin preset
   * both animate `transform` — the preset's keyframes win for the
   * animation's duration and freeze there (`animation-fill-mode: forwards`),
   * clobbering a static rotation. Combining the two on one block is a known,
   * unhandled edge case, not something this step resolves.
   */
  const renderPositionedBlock = (block: LeafBlock, layout: CanvasLayout) => {
    if (!block.position) return null;
    const t = resolveTimedBlock(block);
    if (!t) return null;
    return (
      <div key={t.key} style={{ ...positionStyle(block.position, layout), ...t.style }}>
        {t.rendered}
      </div>
    );
  };

  const overlays: React.ReactNode[] = [];
  for (const block of page.blocks) {
    for (const layer of block.layers ?? []) {
      if (!state.visibleLayers[layer.id]) continue;
      const content = (
        <div key={layer.id} style={layer.modal ? modalOverlayStyle : undefined}>
          <div style={layer.modal ? modalContentStyle : undefined}>
            {layer.dismissible && (
              <button
                onClick={() => setState(closeLayer(state, layer.id))}
                aria-label="Close"
                style={{ float: "right" }}
              >
                ✕
              </button>
            )}
            {layer.blocks.map((lb) => (
              <div key={lb.id}>{renderBlock(lb, ctx)}</div>
            ))}
          </div>
        </div>
      );
      overlays.push(content);
    }
  }

  return (
    <div className={`runtime-course-player${showMenu ? " runtime-course-player--with-menu" : ""}`}>
      {showMenu && (
        <nav className="runtime-course-player__menu" aria-label="Course pages">
          {menuPages.map((p) => (
            <button
              key={p.id}
              onClick={() => goToPage(p.id)}
              className={p.id === page.id ? "is-active" : undefined}
            >
              {state.visitedPages.includes(p.id) ? "✓ " : ""}
              {p.title}
            </button>
          ))}
        </nav>
      )}
      <div className="runtime-course-player__content">
        <h2>{page.title}</h2>
        {canvasLayout ? (
          <>
            <CanvasFrame layout={canvasLayout}>
              {displayBlocks.filter((b) => b.position).map((b) => renderPositionedBlock(b, canvasLayout))}
            </CanvasFrame>
            {/* A canvas-page block with no position falls back to flow placement — validate.ts's POSITION_MISSING_ON_CANVAS documents this rather than the runtime silently dropping it. */}
            <div className="runtime-course-player__blocks">{displayBlocks.filter((b) => !b.position).map(renderTimedBlock)}</div>
          </>
        ) : (
          <div className="runtime-course-player__blocks">{displayBlocks.map(renderTimedBlock)}</div>
        )}
        {overlays}
        {nextPage && (
          <button className="runtime-course-player__next" onClick={() => goToPage(nextPage.id)}>
            Next: {nextPage.title}
          </button>
        )}
        {!nextPage && state.completedAt && <p className="runtime-course-player__complete">✓ Course complete</p>}
      </div>
    </div>
  );
}
