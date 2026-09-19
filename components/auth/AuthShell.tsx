import Link from "next/link";
import type { ReactNode } from "react";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  brand?: string;
  sectionLabel?: string;
  note?: string;
};

/**
 * The intentionally quiet entry point for Orbit. Authentication should
 * make the next step obvious and never feel like an admin screen -- but
 * what "the next step" is depends on which product the visitor is signing
 * in to reach, so callers can override the brand/section copy for that.
 */
export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
  brand = "Orbit Learning",
  sectionLabel = "Learning",
  note = "A calmer way to build real capability, one useful next step at a time.",
}: AuthShellProps) {
  return (
    <main className="auth-page">
      <section className="auth-intro" aria-label={`About ${brand}`}>
        <Link className="auth-brand" href="/">
          <span aria-hidden="true">O</span>
          {brand}
        </Link>
        <p className="auth-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="auth-intro__copy">{description}</p>
        <p className="auth-intro__note">{note}</p>
      </section>

      <section className="auth-panel" aria-label={title}>
        <div className="auth-panel__top">
          <Link className="auth-panel__brand" href="/">
            <span aria-hidden="true">O</span>
            Orbit
          </Link>
          <p>{sectionLabel}</p>
        </div>
        <div className="auth-card">{children}</div>
        {footer && <div className="auth-footer">{footer}</div>}
      </section>
    </main>
  );
}

export function AuthError({ children }: { children: ReactNode }) {
  return <p className="auth-error" role="alert">{children}</p>;
}

export function AuthCheckEmail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <AuthShell eyebrow="Secure account access" title={title} description="We will only ask you for what is needed for this next step.">
      <div className="auth-confirmation" role="status">
        <span aria-hidden="true">↗</span>
        <div>{children}</div>
      </div>
    </AuthShell>
  );
}
