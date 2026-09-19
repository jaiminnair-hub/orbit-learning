import type { ReactNode } from "react";

/**
 * The reusable app-shell primitives — Orbit's shared visual language
 * (item 5 of the pre-Orbit hardening order), applied to the core LMS
 * surfaces first: dashboard, catalogue, completion reporting. The
 * header (app/(app)/layout.tsx) was already token-driven from the
 * earlier Evolv audit; these fill the gap that was actually named in
 * the outstanding-gaps list — page *bodies* bypassing the tokens with
 * ad-hoc inline hex styles.
 *
 * Deliberately not touched: the authoring tool's internal editor
 * screens (admin/authoring, admin/content/*'s block/spec editors) —
 * out of scope per the standing instruction to leave authoring work
 * paused.
 */

export function PageShell({
  children,
  maxWidth = "56rem",
}: {
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <main className="page-shell mx-auto w-full px-6 py-8" style={{ maxWidth }}>
      {children}
    </main>
  );
}

export function PageHeading({
  title,
  description,
}: {
  title: string;
  description?: ReactNode;
}) {
  return (
    <div className="page-heading mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`orbit-card rounded-md border border-border bg-card p-4 text-card-foreground ${className}`}
    >
      {children}
    </div>
  );
}

/** Restrained, deliberately: a small colored dot + label, never a solid wash. */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "secondary" | "success" | "warning" | "danger";
}) {
  const dot: Record<string, string> = {
    neutral: "bg-muted-foreground",
    accent: "bg-accent",
    secondary: "bg-accent-secondary",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-destructive",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dot[tone]}`} />
      {children}
    </span>
  );
}

export function ProgressBar({
  percent,
  tone = "accent",
  label,
}: {
  percent: number;
  tone?: "accent" | "success";
  label?: string;
}) {
  const fill = tone === "success" ? "bg-success" : "bg-accent";
  return (
    <div
      className="h-1.5 w-full rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${percent}%` }} />
    </div>
  );
}
