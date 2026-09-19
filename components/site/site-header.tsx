"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ProductsMenu } from "./products-menu";

const ORBIT_360_SIGN_IN_URL = "/orbit-360/sign-in";

/**
 * Orbit Learning has one real sign-in (`/login`) — role is verified after
 * auth, never chosen by the visitor. `next` only pre-selects where a
 * successful sign-in lands (validated server-side, re-checked per
 * destination in lib/auth/actions.ts) so picking a role here is a shortcut,
 * not a grant. Same three roles and copy as the live /orbit-360/learning
 * page, for consistency across entry points.
 */
const LEARNING_ROLES = [
  { label: "Learner", blurb: "Continue courses, complete assessments and see your progress.", next: "/dashboard" },
  { label: "Learning administrator", blurb: "Manage people, courses, reports and the learning experience.", next: "/admin" },
  { label: "Platform owner", blurb: "Govern organisations, platform access and the environment.", next: "/platform" },
] as const;

/**
 * Public-site header. 360 Feedback has no role split today — one console
 * sign-in for everyone — so it stays a single entry below the role cards.
 */
export function SiteHeader() {
  const [loginOpen, setLoginOpen] = useState(false);
  const loginRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!loginOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (loginRef.current && !loginRef.current.contains(e.target as Node)) {
        setLoginOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLoginOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [loginOpen]);

  return (
    <header className="site-header">
      <div className="site-header__row">
        <Link href="/" className="site-header__brand">
          <span className="site-header__mark">O</span>
          Orbit
        </Link>

        <nav className="site-header__nav" aria-label="Primary">
          <ProductsMenu />
          <Link href="/insights" className="site-header__nav-link">
            Insights
          </Link>
        </nav>

        <div className="site-header__actions" ref={loginRef}>
          <button
            type="button"
            className="site-header__login-btn"
            aria-haspopup="menu"
            aria-expanded={loginOpen}
            onClick={() => setLoginOpen((v) => !v)}
          >
            Log in
            <svg
              className={`site-header__caret${loginOpen ? " is-open" : ""}`}
              width="10"
              height="6"
              viewBox="0 0 10 6"
              fill="none"
              aria-hidden="true"
            >
              <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {loginOpen ? (
            <div className="site-header__login-menu" role="menu">
              <span className="site-header__login-menu-label">Log in as</span>
              {LEARNING_ROLES.map((role) => (
                <Link
                  key={role.next}
                  href={`/login?next=${encodeURIComponent(role.next)}`}
                  role="menuitem"
                  className="site-header__login-option"
                  onClick={() => setLoginOpen(false)}
                >
                  <span className="site-header__login-option-title">{role.label}</span>
                  <span className="site-header__login-option-sub">{role.blurb}</span>
                </Link>
              ))}
              <span className="site-header__login-menu-divider" role="separator" />
              <a
                href={ORBIT_360_SIGN_IN_URL}
                role="menuitem"
                className="site-header__login-option"
                onClick={() => setLoginOpen(false)}
              >
                <span className="site-header__login-option-title">360 Feedback</span>
                <span className="site-header__login-option-sub">Reviews and feedback cycles</span>
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
