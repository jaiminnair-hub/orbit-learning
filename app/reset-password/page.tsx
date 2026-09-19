import { requestPasswordReset } from "@/lib/auth/actions";
import Link from "next/link";
import { AuthError, AuthShell } from "@/components/auth/AuthShell";
import { SubmitButton } from "@/components/auth/SubmitButton";

export default async function RequestPasswordResetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Get back to what matters."
      description="We will send a secure reset link to your email."
      footer={<Link href="/login">Return to log in</Link>}
    >
      <div className="auth-card__heading">
        <p className="auth-kicker">Reset password</p>
        <h2>Reset your password</h2>
        <p>Enter the work email associated with your account.</p>
      </div>
      {error && <AuthError>{error}</AuthError>}
      <form action={requestPasswordReset} className="auth-form">
        <label>
          Email
          <input type="email" name="email" required autoComplete="email" />
        </label>
        <SubmitButton pendingText="Sending...">Send reset link</SubmitButton>
      </form>
    </AuthShell>
  );
}
