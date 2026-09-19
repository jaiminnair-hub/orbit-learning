/**
 * The step-status sink.
 *
 * Workflows expose *instance*-level status through the binding, not per-step
 * status. Per-step progress therefore has to be recorded by the workflow into
 * a store the application can read — which is exactly what
 * `authoring_jobs.steps` exists for in PHASE3_DATA_MODEL.md §2.4.
 *
 * The spike uses D1 rather than KV as the stand-in for that table specifically
 * because D1 is strongly consistent, so an assertion that reads back a step
 * record is testing the workflow engine and not a cache-propagation race.
 */

export interface SpikeEnv {
  SPIKE_DB: D1Database;
  COURSE_GENERATION: Workflow;
}

export type StepPhase = "attempt" | "done";

export type StepEvent = {
  run_id: string;
  step_name: string;
  phase: StepPhase;
  attempt_no: number;
  detail: string | null;
  at: string;
};

let schemaReady = false;

export async function ensureSchema(env: SpikeEnv): Promise<void> {
  if (schemaReady) return;
  await env.SPIKE_DB.exec(
    "CREATE TABLE IF NOT EXISTS spike_events (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "run_id TEXT NOT NULL, " +
      "step_name TEXT NOT NULL, " +
      "phase TEXT NOT NULL, " +
      "attempt_no INTEGER NOT NULL, " +
      "detail TEXT, " +
      "at TEXT NOT NULL)"
  );
  schemaReady = true;
}

/**
 * Records one step event and returns the attempt number for this step.
 *
 * The returned count is what the `retry` scenario branches on, and what the
 * assertions use to prove a completed step was not re-executed.
 */
export async function recordEvent(
  env: SpikeEnv,
  runId: string,
  stepName: string,
  phase: StepPhase,
  detail?: unknown
): Promise<number> {
  await ensureSchema(env);

  const prior = await env.SPIKE_DB.prepare(
    "SELECT COUNT(*) AS n FROM spike_events WHERE run_id = ? AND step_name = ? AND phase = 'attempt'"
  )
    .bind(runId, stepName)
    .first<{ n: number }>();

  const attemptNo = phase === "attempt" ? (prior?.n ?? 0) + 1 : (prior?.n ?? 0);

  await env.SPIKE_DB.prepare(
    "INSERT INTO spike_events (run_id, step_name, phase, attempt_no, detail, at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(
      runId,
      stepName,
      phase,
      attemptNo,
      detail === undefined ? null : JSON.stringify(detail),
      new Date().toISOString()
    )
    .run();

  return attemptNo;
}

export async function readEvents(env: SpikeEnv, runId: string): Promise<StepEvent[]> {
  await ensureSchema(env);
  const { results } = await env.SPIKE_DB.prepare(
    "SELECT run_id, step_name, phase, attempt_no, detail, at FROM spike_events WHERE run_id = ? ORDER BY id ASC"
  )
    .bind(runId)
    .all<StepEvent>();
  return results ?? [];
}

export async function clearEvents(env: SpikeEnv): Promise<void> {
  await ensureSchema(env);
  await env.SPIKE_DB.exec("DELETE FROM spike_events");
}
