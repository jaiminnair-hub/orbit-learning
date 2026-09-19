// Reads connection details from `supabase status` at run time rather than
// hardcoding keys — works locally and in CI regardless of what the CLI
// generates, and never risks committing anything that looks like a secret
// (these are local-only dev credentials anyway, but this is the more
// robust approach regardless).
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

interface LocalStatus {
  API_URL: string;
  DB_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}

let cached: LocalStatus | undefined;

// `npx supabase status` takes ~7-8s once Storage is enabled, and Vitest
// isolates each test file — so the in-memory cache below only helps
// within one file, and every additional file paid the full cost again.
// That was enough on its own to push schema-hygiene past its timeout on
// a query that isn't slow. Caching to disk makes it a once-per-run cost
// instead of once-per-file; the file is short-lived and holds only
// local-only dev credentials.
const CACHE_PATH = path.join(os.tmpdir(), "lms-supabase-status.json");
const CACHE_TTL_MS = 10 * 60 * 1000;

export function getLocalStatus(): LocalStatus {
  if (cached) return cached;

  if (existsSync(CACHE_PATH) && Date.now() - statSync(CACHE_PATH).mtimeMs < CACHE_TTL_MS) {
    try {
      cached = JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as LocalStatus;
      return cached;
    } catch {
      // Corrupt or partially written cache — fall through and re-read.
    }
  }

  const raw = execSync("npx supabase status -o json", { encoding: "utf-8" });
  // Older CLI versions print a "Stopped services: [...]" line before the
  // JSON blob when optional services are disabled — take only the JSON.
  const jsonStart = raw.indexOf("{");
  cached = JSON.parse(raw.slice(jsonStart)) as LocalStatus;

  try {
    mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(cached));
  } catch {
    // Cache is an optimisation, never a correctness requirement.
  }

  return cached;
}

export function createAdminClient(): SupabaseClient {
  const { API_URL, SERVICE_ROLE_KEY } = getLocalStatus();
  return createClient(API_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createAnonClient(): SupabaseClient {
  const { API_URL, ANON_KEY } = getLocalStatus();
  return createClient(API_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// For schema-level checks (e.g. "does pg_class say RLS is enabled") that
// aren't reachable through the Data API at all. Connects directly to
// Postgres via `pg` rather than shelling out to `supabase db query` and
// parsing its stdout — two attempts at that (inline shell arg, then a
// temp file + forced --output-format json) each broke differently on
// GitHub's Linux CI runners despite passing locally on Windows, and a
// direct client connection removes that entire class of problem rather
// than continuing to patch around it.
export async function runSql<T = unknown>(sql: string): Promise<T[]> {
  const { DB_URL } = getLocalStatus();
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const result = await client.query(sql);
    return result.rows as T[];
  } finally {
    await client.end();
  }
}
