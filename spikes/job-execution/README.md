# Job-execution spike (Phase 3, milestone 1)

De-risks the single highest-risk unknown in Phase 3, per
[`docs/DEVELOPMENT_SEQUENCE_PHASE3.md`](../../docs/DEVELOPMENT_SEQUENCE_PHASE3.md) step 1 and
[`docs/PHASE3_TECHNICAL_ARCHITECTURE.md`](../../docs/PHASE3_TECHNICAL_ARCHITECTURE.md) §4.4:
**can Cloudflare durably run the multi-step AI generation pipeline outside a request?**

The verdict is in
[`docs/JOB_EXECUTION_SPIKE_RESULTS.md`](../../docs/JOB_EXECUTION_SPIKE_RESULTS.md). This
directory is the reproducible evidence behind it.

No AI provider is called and no course specification is produced. This milestone tests the
execution substrate only.

## What is here

| File | Purpose |
|---|---|
| `src/workflow.ts` | A `WorkflowEntrypoint` shaped like the real pipeline (`extract → outline → objectives → blocks → assemble`), with scenario switches that force retry, permanent failure, and long suspension |
| `src/store.ts` | The per-step status sink — D1 standing in for `authoring_jobs.steps` |
| `src/index.ts` | Control plane: create a job, poll status, cancel |
| `verify.mjs` | Asserts every claim; exits non-zero on failure |
| `caller/` | A second worker that binds to the workflow across workers via `script_name` — standing in for the Next.js app, which cannot export a workflow class itself |

## Running it

Local (real `workerd`, simulated Workflows engine):

```bash
npx wrangler dev --port 8799 --local
```

Then, in another shell:

```bash
node verify.mjs
```

Against the deployed worker (the real Workflows engine):

```bash
node verify.mjs --base https://your-worker.example.workers.dev
```

Useful flags: `--only <scenario>` to run one, `--sleep <seconds>` to set the duration of the
`long` scenario.

## Why the step-status sink exists

Workflows expose **instance**-level status through the binding, not per-step status. Per-step
progress must therefore be written by the workflow itself into a store the application can
read — which is exactly what `authoring_jobs.steps` is for in
[`docs/PHASE3_DATA_MODEL.md`](../../docs/PHASE3_DATA_MODEL.md) §2.4.

The spike uses D1 rather than KV for this specifically because D1 is strongly consistent, so a
failed assertion means the workflow engine misbehaved and not that a cache had not propagated
yet. In the real system this sink is Supabase Postgres.

## Throwaway resources

This spike creates two resources in the Cloudflare account, both disposable and holding no
tenant data:

- Worker `learning-platform-jobs-spike`
- Worker `learning-platform-jobs-caller-spike`
- D1 database `lms-job-spike`

Remove them with:

```bash
npx wrangler delete --name learning-platform-jobs-spike
```

```bash
npx wrangler delete --name learning-platform-jobs-caller-spike
```

```bash
npx wrangler d1 delete lms-job-spike
```
