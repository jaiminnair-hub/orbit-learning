"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasRole } from "@/lib/auth/roles";

export async function login(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const requestedNext = String(formData.get("next") ?? "");
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : null;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const retry = next ? `&next=${encodeURIComponent(next)}` : "";
    redirect(`/login?error=${encodeURIComponent(error.message)}${retry}`);
  }

  // A requested destination is only a navigation preference. It is
  // validated above and every destination still performs its own role check.
  if (next) redirect(next);

  // An administrator is also a learner. Let people with management access
  // decide which legitimate workspace they want to start in; this never
  // grants a role or changes their permissions.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();
  if (profile && hasRole(profile.role, "manager")) redirect("/choose-workspace");
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  // Without emailRedirectTo, Supabase sends the confirmation link straight
  // to the project's dashboard-configured Site URL, bypassing our
  // /api/auth/callback code-exchange route entirely — the confirmation
  // link lands on a bare page with no session and nothing handling it.
  // requestPasswordReset() below already gets this right; signup() didn't.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${siteUrl}/api/auth/callback?next=/dashboard`,
    },
  });
  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  // If email confirmation is required, there's no session yet — send them
  // to check their inbox rather than pretending they're logged in.
  if (!data.session) {
    redirect("/signup/check-email");
  }
  redirect("/dashboard");
}

export async function requestPasswordReset(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/api/auth/callback?next=/reset-password/confirm`,
  });
  // Always redirect to the same "check your email" page regardless of
  // whether the address exists — never reveal account existence via
  // response timing/content differences.
  redirect("/reset-password/check-email");
}

export async function setNewPassword(formData: FormData) {
  const supabase = await createClient();
  const password = String(formData.get("password") ?? "");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(`/reset-password/confirm?error=${encodeURIComponent(error.message)}`);
  }
  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
