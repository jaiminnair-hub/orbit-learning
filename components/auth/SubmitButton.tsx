"use client";

import { useFormStatus } from "react-dom";

/**
 * A plain <button type="submit"> gives no feedback while a Server Action is
 * in flight, so a slow response invites a second click — which fires a
 * second submission before the first completes. For requestPasswordReset()
 * this caused a real bug: the second (rate-limited, rejected) attempt still
 * overwrote the browser's PKCE code_verifier cookie before failing, so the
 * emailed link — tied to the first attempt's verifier — could never
 * exchange successfully. Traced via Supabase's own Auth logs (2026-08-24):
 * two POST /auth/v1/recover calls five seconds apart from one click.
 */
export function SubmitButton({ children, pendingText }: { children: React.ReactNode; pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
