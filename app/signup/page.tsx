import Link from "next/link";
import { signup } from "@/lib/auth/actions";
import { AuthError, AuthShell } from "@/components/auth/AuthShell";
import { SubmitButton } from "@/components/auth/SubmitButton";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AuthShell
      eyebrow="Start simply"
      title="Make learning useful from day one."
      description="Create your account, then let Orbit help you focus on the next capability that matters."
      footer={<>Already have an account? <Link href="/login">Log in</Link></>}
    >
      <div className="auth-card__heading">
        <p className="auth-kicker">Create account</p>
        <h2>Join Orbit Learning</h2>
        <p>It takes less than a minute to get started.</p>
      </div>
      {error && <AuthError>{error}</AuthError>}
      <form action={signup} className="auth-form">
        <label>
          Full name
          <input type="text" name="fullName" autoComplete="name" />
        </label>
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
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <SubmitButton pendingText="Signing up...">Sign up</SubmitButton>
      </form>
    </AuthShell>
  );
}
