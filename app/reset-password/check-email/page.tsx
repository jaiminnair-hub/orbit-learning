import { AuthCheckEmail } from "@/components/auth/AuthShell";

// See app/orbit/complete/page.tsx for why: static prerendering leaves this
// page's hydration scripts without a nonce matching proxy.ts's per-request CSP.
export const dynamic = "force-dynamic";

export default function ResetPasswordCheckEmailPage() {
  return (
    <AuthCheckEmail title="Check your email">
      <h2>Your reset link is on its way.</h2>
      <p>If an account exists for that address, we sent a secure link to reset your password.</p>
    </AuthCheckEmail>
  );
}
