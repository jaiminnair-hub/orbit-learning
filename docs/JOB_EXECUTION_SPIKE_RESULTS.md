# Job-Execution Spike — Results

**Phase 3, milestone 1.** Written in the shape of [CLOUDFLARE_VALIDATION_RESULTS.md](CLOUDFLARE_VALIDATION_RESULTS.md), as [DEVELOPMENT_SEQUENCE_PHASE3.md](DEVELOPMENT_SEQUENCE_PHASE3.md) step 1 requires.

**Date:** 2026-08-16. **Spike location:** [`spikes/job-execution/`](../spikes/job-execution/) — in-repo, unlike the Phase 1 validation spike, because the verdict here becomes production infrastructure and the assertions should stay re-runnable. **Stack tested:** `wrangler` 4.123.0, `workerd` 1.20260811.1, Cloudflare Workflows, D1. Verified **both** locally under `wrangler dev --local` **and against the real Cloudflare Workflows engine on a live deployment** — the distinction matters, and both columns are reported separately below.

## Verdict

**Proceed with Cloudflare Workflows.** Every claim the milestone required was proven on the real engine, not merely locally. No architectural change to the approved Phase 3 specification is required. Two findings affect implementation detail rather than architecture, and one deployment-topology fact is now settled rather than open.

This closes **§4.4 of [PHASE3_TECHNICAL_ARCHITECTURE.md](PHASE3_TECHNICAL_ARCHITECTURE.md)** — *"the one decision that must be made before building"*.

## The decision: Workflows, not Queues or Durable Objects

| Option | Verdict |
|---|---|
| **Cloudflare Workflows** | **Chosen.** Durable multi-step execution is the primitive itself: per-step memoization, per-step retry policy, suspension across hours, and instance termination are all built in. Nothing had to be hand-rolled. |
| Cloudflare Queues | Rejected. A queue delivers messages; it does not remember which step of a multi-step pipeline already succeeded. Step-level durability would have to be rebuilt on top, which is exactly what Workflows already is. Also requires Workers Paid. |
| Durable Objects | Rejected for this purpose. Would work, but means hand-writing the state machine, retry accounting, and alarm scheduling that Workflows provides. Kept in reserve for a future need for coordination (e.g. collaborative authoring in Phase 6), which is a genuinely different problem. |
| Supabase Edge Functions / external worker | Rejected. Both introduce a second runtime to operate for no capability gain, against the grain of the existing stack. |

**Availability was not a blocker.** Workflows deployed and ran on the existing Cloudflare account with no plan upgrade and no entitlement error — the concern raised in §4.4 ("needs Workers paid tier") did not materialise for Workflows.

## Results by claim

Every row was asserted by [`verify.mjs`](../spikes/job-execution/verify.mjs), not observed by eye.

| # | Claim (from DEVELOPMENT_SEQUENCE_PHASE3.md step 1) | Local `workerd` | Real engine |
|---|---|---|---|
| 1 | Multi-step execution — a 5-step pipeline runs to completion | ✅ Pass | ✅ Pass |
| 2 | Per-step status is externally readable during and after a run | ✅ Pass | ✅ Pass |
| 3 | A failing step is retried per its own retry policy | ✅ Pass — 3 executions | ✅ Pass — 3 executions |
| 4 | **Steps completed before a failure are not re-executed** | ✅ Pass | ✅ Pass |
| 5 | Retry budget is bounded, not infinite | ✅ Pass — 4 executions then stop | ✅ Pass — 4 executions then stop |
| 6 | A run that exhausts retries ends `errored`, never silently `complete` | ✅ Pass | ✅ Pass |
| 7 | Earlier steps' results survive a later permanent failure | ✅ Pass | ✅ Pass |
| 8 | The step after a failure never runs | ✅ Pass | ✅ Pass |
| 9 | An in-flight run can be cancelled | ✅ Pass — reports `terminated` | ✅ Pass — reports `terminated` |
| 10 | No further steps execute after cancellation | ✅ Pass | ✅ Pass |
| 11 | The creating request returns immediately | ✅ Pass — 238ms | ✅ Pass — 2.1s |
| 12 | **A run exceeds a single request's lifetime** | ✅ Pass — 91s, two suspensions | ✅ Pass — **244s, two suspensions** |
| 13 | Outbound `fetch()` works from inside a step | ✅ Pass | ✅ Pass |
| 14 | A worker that does not define the workflow can drive it | n/a | ✅ Pass |

**Claim 4 is the one that mattered most.** "Durable" is easy to assume and easy to get wrong. Each step body writes an attempt row to D1 *before* doing any work, so re-execution is counted rather than trusted. In the retry scenario the failing step shows 3 executions while every preceding step shows exactly 1 — on both runtimes. That is genuine step memoization, and it is what makes partial regeneration (`/regenerate` with a scope, per [PHASE3_AI_ARCHITECTURE.md](PHASE3_AI_ARCHITECTURE.md) §5) implementable rather than aspirational.

**Claim 12 is the headline.** On the real engine a run slept twice, hibernated, resumed, and completed **244 seconds** after the creating request had already returned — with the step between the two sleeps executing exactly once. Long AI generation over a large PDF is therefore not constrained by request lifetime.

## Deployment topology — now settled, not assumed

`@opennextjs/cloudflare` generates `.open-next/worker.js` at build time with a fixed export list (`DOQueueHandler`, `DOShardedTagCache`, `BucketCachePurge`). **The Next.js worker cannot export a `WorkflowEntrypoint` class of ours** — any hand-edit would be overwritten on the next build.

The resolution, verified rather than reasoned about:

```
learning-platform          (Next.js via OpenNext)  ──workflows binding, script_name──▶
learning-platform-jobs     (plain Worker: workflow classes live here)
```

A second worker (`caller/`) that does **not** define the workflow successfully created an instance, polled it to completion, and read back its full output — while the worker that *does* define it saw the identical instance and its per-step records. The binding shape is real and the app can own the control plane without owning the execution.

**This is not a deviation from the approved architecture.** [PHASE3_TECHNICAL_ARCHITECTURE.md](PHASE3_TECHNICAL_ARCHITECTURE.md) §4.4 left the execution location open pending exactly this spike; it is now answered. Phase 2's build pipeline is untouched — the Next.js app gains a binding, never a new build step.

## Two findings that affect implementation

### 1. Workflows expose instance status, not per-step status

The binding's `status()` returns instance-level state (`queued`/`running`/`paused`/`errored`/`terminated`/`complete`) plus final output. It does **not** stream per-step progress. Per-step progress must be written by the workflow itself into a store the application reads.

**This is not a problem — it is what `authoring_jobs.steps` already exists for** ([PHASE3_DATA_MODEL.md](PHASE3_DATA_MODEL.md) §2.4). The spike used D1 as a stand-in (chosen over KV specifically because D1 is strongly consistent, so an assertion tests the engine rather than cache propagation). In the real system the sink is Supabase Postgres via the service role. Worth stating plainly so nobody later expects the binding to supply progress it does not supply.

Wrangler's `workflows instances describe` does expose full per-step detail including timings and outputs — genuinely useful for operational debugging, but it is a CLI/API surface, not something to build the author-facing progress UI on.

### 2. `status()` can fail transiently; the job-status route must be defensive

During the first long-run attempt against the real engine, a status poll returned an opaque Cloudflare **HTTP 500 HTML error page**, aborting the test run. The workflow itself was entirely healthy — `workflows instances describe` showed it mid-sleep and exactly on schedule, and it later completed normally.

The cause was an unhandled throw from the Workflows binding inside the control-plane handler. Two changes followed, both of which the real implementation needs:

- **The job-status route wraps every binding call** and returns a structured `503` with the underlying message, rather than letting an exception become an opaque 500.
- **The poller tolerates transient status-read failures** instead of treating one bad read as job failure. A status read can fail while an instance is being resumed from hibernation.

Reported here rather than fixed silently, per rule 8: it changes no architecture, but a progress UI written without it would report phantom failures on long jobs — precisely the jobs this phase exists to enable.

## What this spike deliberately did not test

Named so they are not mistaken for proven:

| Not tested | Why | When it gets closed |
|---|---|---|
| Any real AI provider call | This milestone is about the execution substrate | Step 7 (AI gateway) |
| Writing to Supabase from inside a step | General outbound HTTPS from a step **is** proven (claim 13); Supabase REST is ordinary HTTPS | Step 8 (generation pipeline) |
| Per-org concurrency caps and cost budgets | Gateway concern, not engine concern | Step 7 |
| RLS / tenant isolation on `authoring_jobs` | The table does not exist yet | Step 4 (data model) |
| Workflow behaviour at scale or under quota pressure | No production load exists to measure | Ongoing |
| Cron-triggered workflows | Not needed by Phase 3's flows | If a scheduled job appears |

## Reproducing

```bash
cd spikes/job-execution && npx wrangler dev --port 8799 --local
```

```bash
cd spikes/job-execution && node verify.mjs
```

Against the deployed engine, add `--base https://your-worker.example.workers.dev`.

The spike's Cloudflare resources are throwaway, hold no tenant data, and are named `*-spike`; removal commands are in [`spikes/job-execution/README.md`](../spikes/job-execution/README.md).

## Consequence for the phase plan

**None — the plan stands.** Step 1 existed to answer *"if this fails, the phase plan changes before code is written."* It did not fail. Step 2 (course specification schema v1 + validator) proceeds as written.
