import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side client — cookie-based, RLS-respecting. Used from Server
// Components, route handlers, and Server Actions. Never use the service
// role here; that's a separate client reserved for platform-admin paths.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component that can't set cookies (no
            // response to attach them to) — safe to ignore as long as a
            // route handler or middleware-equivalent refreshes the
            // session elsewhere. See getSessionContext() in lib/auth/session.ts.
          }
        },
      },
    }
  );
}
