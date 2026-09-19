"use client";

import Link from "next/link";
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { LIFECYCLE_STAGES } from "./capability-lifecycle-data";
import { LearningOrbit } from "./learning-orbit";
import { ProofStrip } from "./proof-strip";
import { StagePictorial } from "./stage-pictorial";

/** "Learn" / "Learn and Assess" / "Learn, Assess and Demonstrate" — never a trailing Oxford comma before "and", matching how this line reads as one sentence. */
function joinNaturally(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The landing hero — headline beside the animated learning orbit (the six
 * stages fixed around a "Capability" centre, cycling through an active
 * state every 12s). Below the first viewport, the same six stages repeat
 * as a horizontal stepper: clicking one opens a panel directly below the
 * row (closes on a second click) with that stage's story, concrete details
 * and a pictorial — each stage recolored in its own bright Orbit accent, on
 * both the card and the panel. Two different jobs for the same data: the
 * orbit is the "what this product is" thesis, the stepper is "tell me more
 * about one of these."
 */
export function CapabilityHero() {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const stageRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rowRef = useRef<HTMLOListElement | null>(null);
  const [caretLeft, setCaretLeft] = useState(60);

  const toggle = useCallback((i: number) => {
    setExpandedIndex((prev) => (prev === i ? null : i));
  }, []);

  useLayoutEffect(() => {
    if (expandedIndex === null) return;
    const update = () => {
      const btn = stageRefs.current[expandedIndex];
      const row = rowRef.current;
      if (!btn || !row) return;
      const btnRect = btn.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      setCaretLeft(btnRect.left - rowRect.left + btnRect.width / 2);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [expandedIndex]);

  const expandedStage = expandedIndex !== null ? LIFECYCLE_STAGES[expandedIndex] : null;
  // Derived from the same data every per-stage badge already reads, rather
  // than a second hardcoded claim — this exact line went stale once
  // already (still said "Learn" after Assess and Demonstrate shipped)
  // because nothing forced it to agree with LIFECYCLE_STAGES.
  const liveLabels = LIFECYCLE_STAGES.filter((s) => s.live).map((s) => s.label);
  const roadmapLabels = LIFECYCLE_STAGES.filter((s) => !s.live).map((s) => s.label);

  return (
    <section aria-labelledby="hero-heading" className="orbit-hero">
      <div className="orbit-hero__row">
        <div className="orbit-hero__copy">
          <span className="orbit-hero__eyebrow">From learning to capability</span>
          <h1 id="hero-heading" className="orbit-hero__title">
            Turn learning into <span className="orbit-hero__title-accent">capability.</span>
          </h1>
          <p className="orbit-hero__sub">
            One connected system to learn, practise, prove skills and grow—powered by real evidence, not
            course completion.
          </p>
          <div className="orbit-hero__cta">
            <Link href="/signup" className="orbit-hero__btn orbit-hero__btn--primary">
              Explore the platform
            </Link>
            <Link href="/login" className="orbit-hero__btn orbit-hero__btn--ghost">
              Log in
            </Link>
          </div>
          <ProofStrip />
        </div>

        <div className="orbit-hero__scene">
          <LearningOrbit />
        </div>
      </div>

      <ol ref={rowRef} className="hero-loop" aria-label="The capability journey — six connected stages">
        {LIFECYCLE_STAGES.map((s, i) => {
          const isExpanded = i === expandedIndex;
          return (
            <li key={s.key} className="hero-loop__item">
              <button
                type="button"
                ref={(el) => {
                  stageRefs.current[i] = el;
                }}
                className={`hero-loop__stage${isExpanded ? " is-active" : ""}${s.live ? " is-live" : ""}`}
                onClick={() => toggle(i)}
                aria-expanded={isExpanded}
                aria-controls="hero-stage-panel"
                style={{ "--stage-accent": s.accentVar, "--stage-surface": s.surfaceVar } as CSSProperties}
              >
                <span className="hero-loop__top">
                  <span className="hero-loop__idx">{String(i + 1).padStart(2, "0")}</span>
                  {s.live ? <span className="hero-loop__live">Live</span> : null}
                </span>
                <span className="hero-loop__name">{s.label}</span>
                <span className="hero-loop__desc">{s.short}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {expandedStage ? (
        <div
          id="hero-stage-panel"
          className="hero-panel"
          role="region"
          aria-label={`${expandedStage.label} details`}
          style={
            {
              "--stage-accent": expandedStage.accentVar,
              "--stage-surface": expandedStage.surfaceVar,
              "--caret-left": `${caretLeft}px`,
            } as CSSProperties
          }
        >
          <span className="hero-panel__caret" aria-hidden="true" />
          <div className="hero-panel__copy">
            <span className="hero-panel__tag">{expandedStage.live ? "Live" : "Roadmap"}</span>
            <h3 className="hero-panel__title">{expandedStage.label}</h3>
            <p className="hero-panel__blurb">{expandedStage.blurb}</p>
            <div className="hero-panel__chips">
              {expandedStage.chips.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          </div>
          <div className="hero-panel__pictorial">
            <StagePictorial stageKey={expandedStage.key} />
          </div>
        </div>
      ) : null}

      <div className="hero-proof">
        <span className="hero-proof__avatars" aria-hidden="true">
          <span>PS</span>
          <span>RM</span>
          <span>MS</span>
        </span>
        <p className="hero-status">
          <strong>Live today: {joinNaturally(liveLabels)}.</strong>{" "}
          {roadmapLabels.length > 0 ? `${joinNaturally(roadmapLabels)} ${roadmapLabels.length === 1 ? "is" : "are"} in active development.` : null}
        </p>
      </div>
    </section>
  );
}
