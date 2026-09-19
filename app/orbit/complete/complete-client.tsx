"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// The client-side half of the Orbit entry bridge (docs/ORBIT_LMS_INTEGRATION_PLAN.md
// §5). app/api/orbit/entry/route.ts cannot finish this itself: an
// admin.generateLink() token has no PKCE code_verifier (only a browser-
// initiated flow like signInWithPassword/signUp sets one), so Supabase's
// own verify step returns tokens in a URL fragment rather than a `?code=`
// — and a fragment never reaches any server. supabase.auth.verifyOtp() is
// the documented client-side counterpart for exactly this case; the SDK is
// what establishes the real session here, this page only calls it.
function CompleteOrbitEntry() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type");
    const next = searchParams.get("next") ?? "/dashboard";

    if (!tokenHash || (type !== "invite" && type !== "magiclink")) {
      router.replace("/login?error=" + encodeURIComponent("Sign-in link is invalid or has expired."));
      return;
    }

    const supabase = createClient();
    supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error: verifyError }) => {
      if (verifyError) {
        router.replace("/login?error=" + encodeURIComponent(`Sign-in link failed: ${verifyError.message}`));
        return;
      }
      router.replace(next);
    });
    // Deliberately runs once — a second effect run with the same, by-then-
    // consumed token_hash would only ever fail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 360 }}>
      <p>Signing you in…</p>
    </main>
  );
}

export function OrbitCompleteClient() {
  return (
    <Suspense fallback={<main style={{ padding: 24, fontFamily: "system-ui" }}>Signing you in…</main>}>
      <CompleteOrbitEntry />
    </Suspense>
  );
}
