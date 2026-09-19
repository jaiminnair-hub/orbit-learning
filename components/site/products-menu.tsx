"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LIFECYCLE_STAGES } from "@/components/three/capability-lifecycle-data";

type ProductKey = "learning" | "feedback";

/** Reuses the hero's own live-stage data, so this can never go stale the
 * way the hero's "Live today" line once did (components/three/capability-hero.tsx). */
const ORBIT_LEARNING_FEATURES = LIFECYCLE_STAGES.filter((s) => s.live).map((s) => ({
  label: s.label,
  blurb: s.blurb,
}));

/** Grounded in the copy actually live on the /orbit-360/360 page —
 * no equivalent shared data file exists for 360 since it's a separate static site. */
const FEEDBACK_360_FEATURES = [
  {
    label: "Perspective-based cycles",
    blurb: "Plan self, manager, peer and other relevant perspectives — not every voice treated as interchangeable.",
  },
  {
    label: "Anonymity protection",
    blurb: "Group thresholds withhold a report until enough voices have responded.",
  },
  {
    label: "AI-assisted setup",
    blurb: "Answer a few prompts and let AI draft the questions and structure — you review and approve before it sends.",
  },
];

const PRODUCTS: Record<
  ProductKey,
  { name: string; tagline: string; href: string; cta: string; features: { label: string; blurb: string }[] }
> = {
  learning: {
    name: "Orbit Learning",
    tagline: "Courses, assessment and certification in one connected system.",
    href: "/signup",
    cta: "Explore Orbit Learning",
    features: ORBIT_LEARNING_FEATURES,
  },
  feedback: {
    name: "360 Feedback",
    tagline: "Feedback people can trust — a deliberate cycle, not a survey blast.",
    href: "/orbit-360/360",
    cta: "Explore 360 Feedback",
    features: FEEDBACK_360_FEATURES,
  },
};

const PRODUCT_KEYS = Object.keys(PRODUCTS) as ProductKey[];

export function ProductsMenu() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ProductKey>("learning");
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const product = PRODUCTS[active];

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div
      ref={wrapperRef}
      className="products-menu"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="products-menu__trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
      >
        Products
        <svg
          className={`products-menu__caret${open ? " is-open" : ""}`}
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          aria-hidden="true"
        >
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="products-menu__panel" role="menu">
          <ul className="products-menu__list" role="none">
            {PRODUCT_KEYS.map((key) => (
              <li key={key} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={`products-menu__item${key === active ? " is-active" : ""}`}
                  onMouseEnter={() => setActive(key)}
                  onFocus={() => setActive(key)}
                  onClick={() => setActive(key)}
                >
                  {PRODUCTS[key].name}
                </button>
              </li>
            ))}
          </ul>

          <div className="products-menu__detail">
            <p className="products-menu__detail-tagline">{product.tagline}</p>
            <ul className="products-menu__features">
              {product.features.map((f) => (
                <li key={f.label}>
                  <span className="products-menu__feature-label">{f.label}</span>
                  <span className="products-menu__feature-blurb">{f.blurb}</span>
                </li>
              ))}
            </ul>
            {product.href.startsWith("http") ? (
              <a href={product.href} className="products-menu__cta" onClick={() => setOpen(false)}>
                {product.cta} <span aria-hidden="true">→</span>
              </a>
            ) : (
              <Link href={product.href} className="products-menu__cta" onClick={() => setOpen(false)}>
                {product.cta} <span aria-hidden="true">→</span>
              </Link>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
