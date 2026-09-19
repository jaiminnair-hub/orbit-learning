"use client";

import type { PageType as Page } from "@/lib/spec";
import { BLOCK_LABELS } from "@/lib/authoring/block-factory";
import { eyebrowStyle, mutedTextStyle } from "./theme";

/**
 * The workspace's bottom Timeline panel — Phase 3B, authoring UI clarity
 * pass step 1. A read-only visual companion to `BlockTimelineTrackEditor`'s
 * numeric fields (still the edit surface for this step; dragging these bars
 * is a later step), so an author can see where every block's
 * appear/disappear window and animations actually land without opening
 * Preview. Clicking a row selects that block, same as clicking it on the
 * Stage.
 */

const ANIMATION_COLOR: Record<string, string> = {
  entrance: "var(--color-success)",
  exit: "var(--color-destructive)",
  emphasis: "var(--accent-secondary)",
};

function cycles(repeat: number | undefined): number {
  return repeat === 0 ? Infinity : (repeat ?? 0) + 1;
}

export function TimelinePanel({
  page,
  selectedBlockId,
  onSelectBlock,
}: {
  page: Page;
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
}) {
  const timeline = page.timeline;

  if (!timeline) {
    return (
      <div>
        <h2 style={eyebrowStyle}>Timeline</h2>
        <p style={mutedTextStyle}>This page has no timeline yet — add one from the Page tab to schedule when blocks appear and animate.</p>
      </div>
    );
  }

  const durationMs = Math.max(timeline.durationMs, 1);
  const tracks = timeline.tracks ?? [];
  const cuePoints = timeline.cuePoints ?? [];
  const seconds = Math.floor(durationMs / 1000);

  return (
    <div>
      <h2 style={eyebrowStyle}>
        Timeline · {(durationMs / 1000).toFixed(1)}s{timeline.autoplay ? " · autoplay" : ""}
      </h2>

      <div style={{ position: "relative", height: 18, marginLeft: 118, borderBottom: "1px solid var(--color-border)", marginBottom: 8 }}>
        {Array.from({ length: seconds + 1 }, (_, s) => (
          <span
            key={s}
            style={{
              position: "absolute",
              left: `${(s * 1000) / durationMs * 100}%`,
              fontSize: ".65rem",
              color: "var(--color-muted-foreground)",
              transform: "translateX(-2px)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {s}s
          </span>
        ))}
        {cuePoints.map((c) => (
          <span
            key={c.id}
            title={c.name ? `${c.name} (${(c.atMs / 1000).toFixed(1)}s)` : `${(c.atMs / 1000).toFixed(1)}s`}
            style={{
              position: "absolute",
              left: `${(c.atMs / durationMs) * 100}%`,
              bottom: -1,
              width: 2,
              height: 10,
              background: "var(--accent-secondary)",
            }}
          />
        ))}
      </div>

      {tracks.length === 0 && <p style={mutedTextStyle}>No block has a scheduled appearance or animation on this page yet.</p>}

      {tracks.map((track) => {
        const block = page.blocks.find((b) => b.id === track.blockId);
        const appearAtMs = track.appearAtMs ?? 0;
        const disappearAtMs = track.disappearAtMs ?? durationMs;
        const isSelected = selectedBlockId === track.blockId;

        return (
          <button
            key={track.blockId}
            type="button"
            onClick={() => onSelectBlock(track.blockId)}
            aria-pressed={isSelected}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "4px 0",
              border: "none",
              background: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 110,
                flexShrink: 0,
                fontSize: ".72rem",
                color: "var(--color-foreground)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontWeight: isSelected ? 700 : 400,
              }}
            >
              {block ? (BLOCK_LABELS[block.type] ?? block.type) : track.blockId}
            </span>
            <div
              style={{
                position: "relative",
                flex: 1,
                height: 16,
                background: "var(--color-background)",
                borderRadius: "var(--radius-sm)",
                outline: isSelected ? "2px solid var(--accent-secondary)" : undefined,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: `${(appearAtMs / durationMs) * 100}%`,
                  width: `${((disappearAtMs - appearAtMs) / durationMs) * 100}%`,
                  top: 0,
                  bottom: 0,
                  background: "var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                }}
              />
              {(track.animations ?? [])
                .filter((a) => a.kind !== "motion")
                .map((a) => {
                  const totalCycles = cycles(a.repeat);
                  const windowMs = totalCycles === Infinity ? durationMs - a.startMs : a.durationMs * totalCycles;
                  return (
                    <div
                      key={a.id}
                      title={`${a.kind} · ${a.preset} · ${(a.startMs / 1000).toFixed(1)}s–${(Math.min(a.startMs + windowMs, durationMs) / 1000).toFixed(1)}s`}
                      style={{
                        position: "absolute",
                        left: `${(a.startMs / durationMs) * 100}%`,
                        width: `${(Math.min(windowMs, durationMs - a.startMs) / durationMs) * 100}%`,
                        top: 2,
                        bottom: 2,
                        background: ANIMATION_COLOR[a.kind] ?? "var(--accent-secondary)",
                        borderRadius: "var(--radius-sm)",
                        opacity: 0.85,
                      }}
                    />
                  );
                })}
            </div>
          </button>
        );
      })}
    </div>
  );
}
