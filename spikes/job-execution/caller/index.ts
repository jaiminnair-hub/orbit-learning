/**
 * The integration point, isolated.
 *
 * `@opennextjs/cloudflare` generates `.open-next/worker.js` at build time with a
 * fixed set of exports, so the Next.js app cannot itself export a
 * `WorkflowEntrypoint` class. The workflow therefore lives in its own worker,
 * and the app binds to it across workers via `script_name`.
 *
 * This worker exists purely to prove that binding shape works — that a worker
 * which does NOT define the workflow can still create, inspect, and cancel its
 * instances. It stands in for the Next.js app.
 */

interface CallerEnv {
  COURSE_GENERATION: Workflow;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: CallerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/remote-create") {
      const runId = crypto.randomUUID();
      const instance = await env.COURSE_GENERATION.create({
        id: runId,
        params: { runId, scenario: "happy" },
      });
      return json({
        boundFrom: "a worker that does not define the workflow",
        id: instance.id,
        status: await instance.status(),
      });
    }

    const match = url.pathname.match(/^\/remote-status\/([0-9a-fA-F-]{36})$/);
    if (match) {
      const instance = await env.COURSE_GENERATION.get(match[1]);
      return json({ id: match[1], status: await instance.status() });
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<CallerEnv>;
