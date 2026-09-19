/**
 * Conformance runner for the Phase 3 job-execution spike.
 *
 * Drives every scenario against a running worker and asserts the specific
 * claims DEVELOPMENT_SEQUENCE_PHASE3.md step 1 requires:
 *
 *   multi-step execution · per-step status · retry · no re-execution of
 *   completed steps · partial results survive failure · cancellation ·
 *   a run that outlives the request that created it · outbound egress
 *
 * Usage:
 *   npx wrangler dev --port 8799 --local      (in spikes/job-execution)
 *   node verify.mjs [--base http://127.0.0.1:8799] [--sleep 90] [--only long]
 *
 * Exits non-zero if any claim fails.
 */

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const BASE = argOf("base", "http://127.0.0.1:8799");
const SLEEP_SECONDS = Number(argOf("sleep", "90"));
const ONLY = argOf("only", null);

const results = [];
let failures = 0;

function check(claim, ok, detail) {
  results.push({ claim, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${claim}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${path} (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  return { status: res.status, body };
}

async function createJob(scenario, extra = {}) {
  const { status, body } = await api("/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenario, ...extra }),
  });
  if (status !== 202) throw new Error(`create ${scenario} returned HTTP ${status}`);
  return body.id;
}

async function getJob(id) {
  const { body } = await api(`/jobs/${id}`);
  return body;
}

/**
 * Polls until the instance reaches a terminal state or the deadline passes.
 *
 * Transient poll failures are tolerated rather than fatal: against the real
 * engine, a status read can fail while an instance is being resumed from
 * hibernation. Aborting the whole run on one bad read would report an engine
 * failure that did not happen — the polling UI has to survive this too.
 */
async function waitForTerminal(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const terminal = new Set(["complete", "errored", "terminated"]);
  let last;
  let transientErrors = 0;
  while (Date.now() < deadline) {
    try {
      last = await getJob(id);
      if (terminal.has(last.status?.status)) {
        if (transientErrors) console.log(`  note: ${transientErrors} transient poll error(s) absorbed`);
        return last;
      }
    } catch (err) {
      transientErrors++;
      if (transientErrors > 10) throw err;
    }
    await sleep(2000);
  }
  return last;
}

/** attempt-phase execution count per step name. */
function attemptCounts(job) {
  const counts = {};
  for (const e of job.steps ?? []) {
    if (e.phase === "attempt") counts[e.step_name] = (counts[e.step_name] ?? 0) + 1;
  }
  return counts;
}

function completedSteps(job) {
  return (job.steps ?? []).filter((e) => e.phase === "done").map((e) => e.step_name);
}

const scenarios = {
  async happy() {
    const id = await createJob("happy");
    const job = await waitForTerminal(id, 60_000);
    check("happy: instance reaches `complete`", job.status?.status === "complete", job.status?.status);

    const counts = attemptCounts(job);
    const expected = [
      "extract_source",
      "generate_outline",
      "generate_objectives",
      "generate_blocks",
      "assemble_and_validate",
    ];
    check(
      "happy: all five pipeline steps executed",
      expected.every((s) => counts[s] === 1),
      JSON.stringify(counts)
    );
    check(
      "happy: per-step status is externally readable mid/post-run",
      completedSteps(job).length === 5,
      `${completedSteps(job).length} done-records`
    );
    check(
      "happy: final output is the assembled result",
      job.status?.output?.validated?.valid === true,
      JSON.stringify(job.status?.output?.validated)
    );
  },

  async retry() {
    const id = await createJob("retry");
    const job = await waitForTerminal(id, 90_000);
    check("retry: instance still reaches `complete`", job.status?.status === "complete", job.status?.status);

    const counts = attemptCounts(job);
    check(
      "retry: the failing step was retried until it succeeded",
      counts.generate_blocks === 3,
      `generate_blocks executed ${counts.generate_blocks}x`
    );
    // The claim that actually matters: durability means work already done is
    // not thrown away and redone when a later step fails.
    const priorSteps = ["extract_source", "generate_outline", "generate_objectives"];
    check(
      "retry: steps completed BEFORE the failure were not re-executed",
      priorSteps.every((s) => counts[s] === 1),
      JSON.stringify(counts)
    );
  },

  async fail() {
    const id = await createJob("fail");
    const job = await waitForTerminal(id, 90_000);
    check("fail: instance ends in `errored`, not silently complete", job.status?.status === "errored", job.status?.status);

    const counts = attemptCounts(job);
    check(
      "fail: retry budget was exhausted rather than retried forever",
      counts.generate_blocks >= 2 && counts.generate_blocks <= 5,
      `generate_blocks executed ${counts.generate_blocks}x`
    );
    check(
      "fail: results of earlier steps survive the failure (partial recovery is possible)",
      ["extract_source", "generate_outline", "generate_objectives"].every((s) =>
        completedSteps(job).includes(s)
      ),
      completedSteps(job).join(", ")
    );
    check(
      "fail: the step after the failure never ran",
      !completedSteps(job).includes("assemble_and_validate"),
      completedSteps(job).join(", ")
    );
  },

  async cancel() {
    const id = await createJob("cancel", { sleepSeconds: 120 });
    await sleep(3000);
    const before = await getJob(id);
    check("cancel: instance is in flight before cancelling", before.status?.status === "running" || before.status?.status === "waiting", before.status?.status);

    const { status, body } = await api(`/jobs/${id}/cancel`, { method: "POST" });
    check("cancel: cancel request accepted", status === 200 && body.cancelled === true, `HTTP ${status}`);

    await sleep(3000);
    const after = await getJob(id);
    check("cancel: instance reports `terminated`", after.status?.status === "terminated", after.status?.status);

    const countsAfter = attemptCounts(after);
    await sleep(8000);
    const later = await getJob(id);
    check(
      "cancel: no further steps execute after termination",
      JSON.stringify(attemptCounts(later)) === JSON.stringify(countsAfter),
      JSON.stringify(attemptCounts(later))
    );
  },

  async long() {
    // The headline claim: work continues after the creating request is gone.
    const t0 = Date.now();
    const id = await createJob("long", { sleepSeconds: SLEEP_SECONDS });
    const createMs = Date.now() - t0;
    check(
      "long: creating request returns immediately (does not hold the run open)",
      createMs < 3000,
      `${createMs}ms`
    );

    await sleep(5000);
    const midway = await getJob(id);
    check(
      "long: run is still alive with no client attached",
      ["running", "waiting", "queued"].includes(midway.status?.status),
      midway.status?.status
    );

    const job = await waitForTerminal(id, (SLEEP_SECONDS + 90) * 1000);
    const totalMs = Date.now() - t0;
    check("long: run completes", job.status?.status === "complete", job.status?.status);
    check(
      `long: total wall-clock exceeded a single request lifetime (>${SLEEP_SECONDS}s across two suspensions)`,
      totalMs >= SLEEP_SECONDS * 1000,
      `${Math.round(totalMs / 1000)}s`
    );
    const counts = attemptCounts(job);
    check(
      "long: the step between the two sleeps ran exactly once",
      counts.after_first_sleep === 1,
      JSON.stringify(counts)
    );
  },

  async egress() {
    const id = await createJob("egress");
    const job = await waitForTerminal(id, 90_000);
    check("egress: instance reaches `complete`", job.status?.status === "complete", job.status?.status);
    check(
      "egress: outbound fetch from inside a step succeeded",
      (job.status?.output?.egress?.bytes ?? 0) > 0,
      JSON.stringify(job.status?.output?.egress)
    );
  },
};

const order = ["happy", "retry", "fail", "cancel", "egress", "long"];

(async () => {
  const health = await api("/health").catch((e) => {
    console.error(`\nCannot reach the spike worker at ${BASE}.`);
    console.error("Start it with: npx wrangler dev --port 8799 --local\n");
    console.error(String(e));
    process.exit(2);
  });
  console.log(`Spike worker reachable at ${BASE} (${health.body.scenarios.length} scenarios)\n`);

  for (const name of order) {
    if (ONLY && ONLY !== name) continue;
    console.log(`[${name}]`);
    try {
      await scenarios[name]();
    } catch (err) {
      check(`${name}: scenario ran without throwing`, false, String(err?.message ?? err));
    }
    console.log("");
  }

  const total = results.length;
  console.log("─".repeat(60));
  console.log(`${total - failures}/${total} claims proven`);
  if (failures > 0) {
    console.log("\nUnproven claims:");
    for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.claim} (${r.detail})`);
  }
  // Set the code rather than calling process.exit(): forcing exit while undici
  // still holds keep-alive sockets trips a libuv assertion on Windows.
  process.exitCode = failures > 0 ? 1 : 0;
})();
