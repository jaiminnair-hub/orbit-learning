import { getLocalStatus } from "./local-supabase";

/**
 * Resolves the local Supabase connection details once, before any test file
 * runs.
 *
 * `local-supabase.ts` already caches to disk, which turned a per-file cost
 * into a per-run one — but it left a thundering herd on a cold cache. Vitest
 * starts several file-workers at once; if none of them finds the cache, all
 * of them spawn `npx supabase status` simultaneously, and that command
 * queries the Docker API. That is the same pressure that produced Docker 502s
 * in the Playwright suite (see tests/e2e/local-supabase-admin.ts).
 *
 * Warming it here means exactly one process ever pays the cold cost, and
 * every worker finds a populated cache.
 */
export default function setup() {
  getLocalStatus();
}
