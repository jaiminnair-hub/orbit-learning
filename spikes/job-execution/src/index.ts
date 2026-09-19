import { clearEvents, ensureSchema, readEvents, type SpikeEnv } from "./store";
import type { SpikeParams, SpikeScenario } from "./workflow";

export { CourseGenerationSpikeWorkflow } from "./workflow";

const SCENARIOS: SpikeScenario[] = ["happy", "retry", "long", "fail", "cancel", "egress"];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * The control plane the Next.js app will eventually own: create a job, poll its
 * status, cancel it. Kept deliberately thin — the point of the spike is the
 * engine underneath, not this surface.
 */
export default {
  async fetch(request: Request, env: SpikeEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health") {
      return json({ ok: true, scenarios: SCENARIOS });
    }

    if (path === "/reset" && request.method === "POST") {
      await clearEvents(env);
      return json({ ok: true });
    }

    if (path === "/jobs" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        scenario?: string;
        sleepSeconds?: number;
      };
      const scenario = body.scenario as SpikeScenario | undefined;
      if (!scenario || !SCENARIOS.includes(scenario)) {
        return json({ error: `scenario must be one of ${SCENARIOS.join(", ")}` }, 400);
      }

      await ensureSchema(env);
      const runId = crypto.randomUUID();
      const params: SpikeParams = { runId, scenario, sleepSeconds: body.sleepSeconds };
      const instance = await env.COURSE_GENERATION.create({ id: runId, params });

      // Returns immediately. Nothing about the run depends on this request
      // staying open — that is the property being demonstrated.
      return json({ id: instance.id, runId, scenario, status: await instance.status() }, 202);
    }

    const jobMatch = path.match(/^\/jobs\/([0-9a-fA-F-]{36})(\/cancel)?$/);
    if (jobMatch) {
      const id = jobMatch[1];
      const isCancel = Boolean(jobMatch[2]);

      // Everything touching the Workflows binding is wrapped: `get()` and
      // `status()` can both throw transiently against the real engine, and an
      // unhandled throw here surfaces as an opaque Cloudflare 500 HTML page
      // rather than something a caller can reason about. The real job-status
      // route needs this same defensiveness.
      try {
        const instance = await env.COURSE_GENERATION.get(id);

        if (isCancel) {
          if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
          await instance.terminate();
          return json({ id, cancelled: true, status: await instance.status() });
        }

        return json({
          id,
          status: await instance.status(),
          steps: await readEvents(env, id),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/not found/i.test(message)) return json({ error: "not found", id }, 404);
        return json({ error: "workflow binding error", id, message }, 503);
      }
    }

    return json({ error: "not found", path }, 404);
  },
} satisfies ExportedHandler<SpikeEnv>;
