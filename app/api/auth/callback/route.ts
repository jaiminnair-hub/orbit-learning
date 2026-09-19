import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles both OAuth logins and email-link flows (signup confirmation,
// password reset) — both use the same PKCE code-exchange mechanism.
// Provider-agnostic: enabling a specific OAuth provider (e.g. Google) is a
// Supabase dashboard/provider-console configuration step, not code here.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { searchParams } = url;
  // Vercel's own edge-to-edge rewrite (a front-door domain proxying to
  // this app) does not change what request.url reports — this app still
  // sees its own raw domain even when reached through the front door.
  // x-forwarded-host carries the domain the browser actually visited, and
  // is only absent for a request that wasn't proxied at all (local dev, or
  // this deployment hit directly), where url.origin is already correct.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const origin = forwardedHost ? `https://${forwardedHost}` : url.origin;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // Surface Supabase's actual reason rather than a generic message —
    // "invalid or expired" was masking whether the token itself was
    // rejected vs. the code-exchange step failing for another reason
    // (e.g. a missing PKCE code_verifier cookie from a different browser
    // session than the one that requested the link).
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(`Sign-in link failed: ${error.message}`)}`
    );
  }

  // No `code` at all — Supabase's own verify step rejected the link before
  // ever redirecting here with one. Surface whatever it reported instead of
  // a generic message, so a dead/expired/reused link is distinguishable
  // from a genuine app-side exchange failure.
  const upstreamError = searchParams.get("error_description") ?? searchParams.get("error");
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(
      upstreamError ? `Sign-in link failed: ${upstreamError}` : "Sign-in link is invalid or has expired."
    )}`
  );
}
