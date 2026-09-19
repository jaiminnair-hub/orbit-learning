import { AuthCheckEmail } from "@/components/auth/AuthShell";

// Static prerendering leaves this page's own hydration scripts without a
// nonce matching proxy.ts's per-request CSP (see app/orbit/complete/page.tsx
// for the full mechanism) — force-dynamic keeps every route consistently
// hydratable rather than relying on this page happening to need no JS today.
export const dynamic = "force-dynamic";

export default function CheckEmailPage() {
  return (
    <AuthCheckEmail title="Check your email">
      <h2>Your confirmation link is on its way.</h2>
      <p>Open the email we just sent and select the link to activate your account.</p>
    </AuthCheckEmail>
  );
}
