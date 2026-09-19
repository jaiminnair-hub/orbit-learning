import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyEntryToken } from "@/lib/orbit/entry-token";
import { errorResponse } from "@/lib/api/response";

// The Orbit -> LMS entry bridge. See docs/ORBIT_LMS_INTEGRATION_PLAN.md §5
// for the full design. This route is deliberately NOT wrapped in
// withAuth() — there is no LMS session yet at the point this runs; the
// entry token itself is the only credential, verified below.
//
// No GET handler is exported on purpose: Next.js returns 405 for any
// method not exported from this file, which is what keeps the entry
// token confined to a POST body — it must never be deliverable via a URL
// query parameter (browser history, Referer, access logs).
export async function POST(request: Request) {
  const token = await readToken(request);
  if (!token) {
    return errorResponse("INVALID_REQUEST", "Missing entry token.", 400);
  }

  const payload = verifyEntryToken(token);
  if (!payload) {
    return errorResponse("INVALID_TOKEN", "Entry token is invalid, expired, or malformed.", 401);
  }

  const admin = createAdminClient();

  // Replay guard: the jti's primary-key uniqueness is what makes a reuse
  // fail atomically. This must happen before any other step — a token
  // that reaches org-link lookup or profile provisioning has, by
  // definition, not been used before.
  const { error: replayError } = await admin
    .from("orbit_entry_token_uses")
    .insert({ jti: payload.jti });
  if (replayError) {
    return errorResponse("TOKEN_ALREADY_USED", "This entry token has already been used.", 401);
  }

  const { data: orgLink } = await admin
    .from("orbit_organization_links")
    .select("lms_organization_id")
    .eq("orbit_organization_id", payload.orbitOrgId)
    .maybeSingle();
  if (!orgLink) {
    return errorResponse("ORG_NOT_LINKED", "This Orbit organization is not linked to an LMS organization.", 403);
  }

  const { data: roleMap } = await admin
    .from("orbit_role_map")
    .select("lms_role")
    .eq("orbit_product_role_key", payload.orbitProductRoleKey)
    .maybeSingle();
  if (!roleMap?.lms_role) {
    return errorResponse(
      "ROLE_NOT_SUPPORTED",
      "This Orbit LMS role is not yet supported for entry into the LMS.",
      403
    );
  }

  const email = payload.email.trim().toLowerCase();
  const appOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (!appOrigin) {
    return errorResponse("NOT_CONFIGURED", "NEXT_PUBLIC_SITE_URL is not configured.", 500);
  }

  // admin.generateLink() cannot use the existing /api/auth/callback route —
  // that route only handles the PKCE `?code=` exchange, which requires a
  // code_verifier the *browser* set before the link was requested (true for
  // signInWithPassword/signUp/resetPasswordForEmail, all client-initiated).
  // A server-minted admin link has no such verifier, so Supabase's own verify
  // step instead returns tokens in the URL fragment (confirmed by directly
  // curling a local action_link during implementation) — a fragment never
  // reaches any server, PKCE or not. The supported alternative for an
  // admin-generated link is client-side supabase.auth.verifyOtp({ token_hash,
  // type }), which /orbit/complete performs — still 100% the SDK establishing
  // the session, never this route.
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  let userId: string;

  if (existingProfile) {
    userId = existingProfile.id;
    const { error: updateError } = await admin
      .from("profiles")
      .update({ org_id: orgLink.lms_organization_id, role: roleMap.lms_role })
      .eq("id", userId);
    if (updateError) {
      return errorResponse("PROFILE_UPDATE_FAILED", updateError.message, 500);
    }
  } else {
    // A brand-new person: `invite` creates the auth.users row itself, which
    // the existing on_auth_user_created trigger turns into a bare profiles
    // row (org_id null, role 'learner') before we ever see it — the update
    // below is what sets the real org/role server-side.
    const { data: invited, error: inviteError } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
    });
    if (inviteError || !invited?.user?.id || !invited.properties?.hashed_token) {
      return errorResponse("PROVISIONING_FAILED", inviteError?.message ?? "Could not provision this user.", 500);
    }
    userId = invited.user.id;
    const { error: updateError } = await admin
      .from("profiles")
      .update({ org_id: orgLink.lms_organization_id, role: roleMap.lms_role })
      .eq("id", userId);
    if (updateError) {
      return errorResponse("PROFILE_UPDATE_FAILED", updateError.message, 500);
    }
    return NextResponse.redirect(completeUrl(appOrigin, invited.properties.hashed_token, "invite"), { status: 303 });
  }

  // An existing person: generates a one-time verification token, nothing
  // more — /orbit/complete's client-side verifyOtp() is what actually
  // establishes the real session.
  const { data: signedIn, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !signedIn?.properties?.hashed_token) {
    return errorResponse("LINK_GENERATION_FAILED", linkError?.message ?? "Could not generate a sign-in link.", 500);
  }

  return NextResponse.redirect(completeUrl(appOrigin, signedIn.properties.hashed_token, "magiclink"), { status: 303 });
}

// Orbit's shell delivers the token as an auto-submitting HTML form POST
// (docs/ORBIT_LMS_INTEGRATION_PLAN.md §5 — a real form, not fetch(), so the
// token never touches client-side JS state either) — that arrives as
// application/x-www-form-urlencoded, not JSON. A server-to-server caller
// may still send JSON; both are accepted, neither is a query parameter.
async function readToken(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    return typeof body?.token === "string" ? body.token : null;
  }
  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  return typeof token === "string" ? token : null;
}

function completeUrl(appOrigin: string, tokenHash: string, type: "invite" | "magiclink"): string {
  const url = new URL("/orbit/complete", appOrigin);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  url.searchParams.set("next", "/dashboard");
  return url.toString();
}
