// Direct DB access for e2e specs and setup, against the local disposable
// Supabase instance (things no app route exposes — e.g. confirming an
// activity_log row was actually written).
//
// **Why this file is more careful than it looks.** `supabase status` queries
// the Docker API. Playwright runs every spec file in its own worker process,
// so a module-level cache helps within a file and not at all across them —
// each of the eight spec files was independently spawning `npx supabase
// status`, and `tenant-isolation-api.spec.ts` spawned it three more times on
// its own. Roughly eleven Docker API queries and eleven `npx` process starts
// per run, each one an ~7-8s `execSync` that blocks the event loop.
//
// That was not a theoretical cost. A full-suite run failed with
// `failed to list containers: request returned 502 Bad Gateway` raised from
// this file — the harness was hammering Docker hard enough to make Docker
// refuse it, and the resulting failures looked like flaky application code.
//
// So: global setup resolves the details **once** and writes them here, every
// worker reads that file, and nothing shells out unless the file is missing.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface LocalStatus {
  API_URL: string;
  SERVICE_ROLE_KEY: string;
  PUBLISHABLE_KEY: string;
  SECRET_KEY: string;
}

/** Written by global-setup, read by every worker. Local-only dev credentials. */
const STATUS_PATH = path.join(__dirname, ".auth", "local-supabase.json");

let cachedStatus: LocalStatus | undefined;
let cachedClient: SupabaseClient | undefined;

/**
 * Shells out to the CLI. The slow path — called once per run by global
 * setup, and otherwise only when a spec is run without it.
 *
 * Retries because the failure this whole file exists to avoid is transient:
 * a Docker API 502 under load succeeds moments later, and failing the entire
 * run over it wastes the ten minutes already spent.
 */
export function readStatusFromCli(attempts = 3): LocalStatus {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const raw = execSync("npx supabase status -o json", { encoding: "utf-8" });
      // Older CLI versions print "Stopped services: [...]" before the JSON.
      const jsonStart = raw.indexOf("{");
      if (jsonStart < 0) throw new Error(`No JSON in supabase status output: ${raw.slice(0, 200)}`);
      return JSON.parse(raw.slice(jsonStart)) as LocalStatus;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        // Synchronous backoff: this runs in setup, before any test, and the
        // alternative is an async API every caller would have to thread.
        const until = Date.now() + attempt * 2000;
        while (Date.now() < until) {
          /* wait */
        }
      }
    }
  }
  throw new Error(
    `Could not read local Supabase status after ${attempts} attempts. Is Docker running and \`npx supabase start\` done? Cause: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

/** Called once by global setup so no worker ever has to shell out. */
export function writeStatusForWorkers(status: LocalStatus): void {
  mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  writeFileSync(STATUS_PATH, JSON.stringify(status));
}

export function getLocalStatus(): LocalStatus {
  if (cachedStatus) return cachedStatus;

  if (existsSync(STATUS_PATH)) {
    try {
      cachedStatus = JSON.parse(readFileSync(STATUS_PATH, "utf-8")) as LocalStatus;
      return cachedStatus;
    } catch {
      // Corrupt or half-written — fall through to the CLI rather than fail.
    }
  }

  cachedStatus = readStatusFromCli();
  return cachedStatus;
}

/**
 * One admin client per worker process.
 *
 * Previously every call built a new one. Nothing about the client is
 * per-call, and each construction previously dragged an `execSync` behind it.
 */
export function createLocalAdminClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const { API_URL, SERVICE_ROLE_KEY } = getLocalStatus();
  cachedClient = createClient(API_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedClient;
}
