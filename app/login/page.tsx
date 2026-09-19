import Link from "next/link";
import { login } from "@/lib/auth/actions";
import { AuthError, AuthShell } from "@/components/auth/AuthShell";
import { SubmitButton } from "@/components/auth/SubmitButton";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "";
  const isPlatformDestination = safeNext.startsWith("/platform");

  return (
    <AuthShell
      eyebrow={isPlatformDestination ? "Platform Control" : "Welcome back"}
      title={isPlatformDestination ? "The control plane for every Orbit workspace." : "Continue your learning journey."}
      description={
        isPlatformDestination
          ? "Platform Control is the cross-tenant view for Orbit's own team: the organization directory, product portfolio health, QA runs, and activity log, all in one place. It's separate from any organization's own workspace."
          : "Pick up the work that matters, with your progress and learning in one place."
      }
      brand={isPlatformDestination ? "Orbit" : "Orbit Learning"}
      sectionLabel={isPlatformDestination ? "Platform Control" : "Learning"}
      note={isPlatformDestination ? "Restricted to platform owners and administrators." : undefined}
      footer={
        isPlatformDestination ? undefined : (
          <>New to Orbit Learning? <Link href="/signup">Create an account</Link></>
        )
      }
    >
      <div className="auth-card__heading">
        <p className="auth-kicker">Sign in</p>
        <h2>Welcome back</h2>
        <p>Use your work email and password to continue.</p>
      </div>
      {error && <AuthError>{error}</AuthError>}
      <form action={login} className="auth-form">
        <input type="hidden" name="next" value={safeNext} />
        <label>
          Email
          <input type="email" name="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
          />
        </label>
        <SubmitButton pendingText="Logging in...">Log in</SubmitButton>
      </form>
      <Link className="auth-text-link" href="/reset-password">Forgot your password?</Link>
    </AuthShell>
  );
}
