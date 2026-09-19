import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS entirely. Server-only; SUPABASE_SECRET_KEY
// is never exposed to the browser (no NEXT_PUBLIC_ prefix). Reserved for the
// two cases the tenant-facing client structurally cannot do (see
// docs/MULTI_TENANCY.md §4): writing activity_log rows (no insert policy for
// authenticated — service-role only, by design) and platform-admin
// cross-tenant reads/writes. Never use this for a normal user-scoped
// operation just to sidestep RLS.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
