import { setNewPassword } from "@/lib/auth/actions";
import { AuthError, AuthShell } from "@/components/auth/AuthShell";
import { SubmitButton } from "@/components/auth/SubmitButton";

export default async function SetNewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AuthShell eyebrow="Account recovery" title="Set a new password." description="Choose a secure password, then return to your learning.">
      <div className="auth-card__heading">
        <p className="auth-kicker">New password</p>
        <h2>Keep your account secure</h2>
        <p>Use at least eight characters.</p>
      </div>
      {error && <AuthError>{error}</AuthError>}
      <form action={setNewPassword} className="auth-form">
        <label>
          New password
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <SubmitButton pendingText="Saving...">Set password</SubmitButton>
      </form>
    </AuthShell>
  );
}
