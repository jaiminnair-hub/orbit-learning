import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { ensureSchema, recordEvent, type SpikeEnv } from "./store";

/**
 * The scenarios this spike exists to prove. Each one isolates a single claim
 * from DEVELOPMENT_SEQUENCE_PHASE3.md step 1 so a failure names itself.
 */
export type SpikeScenario =
  | "happy" // multi-step execution + per-step status
  | "retry" // per-step retry, and completed steps are NOT re-executed
  | "long" // a run that outlives the request that created it
  | "fail" // retry budget exhausted; earlier step results survive
  | "cancel" // termination of an in-flight run
  | "egress"; // outbound fetch from inside a step

export type SpikeParams = {
  runId: string;
  scenario: SpikeScenario;
  /** Used by the `long` and `cancel` scenarios. */
  sleepSeconds?: number;
};

/**
 * Deliberately shaped like the real pipeline in PHASE3_AI_ARCHITECTURE.md §5
 * (extract -> outline -> objectives -> blocks -> assemble+validate) rather than
 * generic "step1/step2", so what the spike proves maps onto what will be built.
 *
 * No AI provider is called and no course specification is produced — this
 * milestone is about the execution substrate only.
 */
export class CourseGenerationSpikeWorkflow extends WorkflowEntrypoint<SpikeEnv, SpikeParams> {
  async run(event: WorkflowEvent<SpikeParams>, step: WorkflowStep) {
    const { runId, scenario, sleepSeconds = 90 } = event.payload;
    await ensureSchema(this.env);

    // Every step body records an `attempt` row BEFORE doing any work. Counting
    // those rows afterwards is what proves whether a step re-executed — the
    // single most important property of a durable engine, and the one that is
    // easiest to assume rather than verify.
    const attempt = (name: string) => recordEvent(this.env, runId, name, "attempt");
    const done = (name: string, detail?: unknown) =>
      recordEvent(this.env, runId, name, "done", detail);

    const source = await step.do("extract_source", async () => {
      await attempt("extract_source");
      const result = { chars: 4096, kind: "pdf" };
      await done("extract_source", result);
      return result;
    });

    const outline = await step.do("generate_outline", async () => {
      await attempt("generate_outline");
      const result = { sections: 4, pages: 12, fromChars: source.chars };
      await done("generate_outline", result);
      return result;
    });

    if (scenario === "egress") {
      // Proves a step can reach the public internet — the AI gateway and URL
      // ingest both depend on this working from inside workflow execution,
      // not merely from a request handler.
      const egress = await step.do(
        "outbound_fetch",
        { retries: { limit: 2, delay: "2 seconds", backoff: "constant" }, timeout: "30 seconds" },
        async () => {
          await attempt("outbound_fetch");
          const res = await fetch("https://cloudflare.com/cdn-cgi/trace");
          if (!res.ok) throw new Error(`egress failed: HTTP ${res.status}`);
          const text = await res.text();
          const result = { ok: true, bytes: text.length };
          await done("outbound_fetch", result);
          return result;
        }
      );
      return { scenario, source, outline, egress };
    }

    if (scenario === "long" || scenario === "cancel") {
      // Two separate suspensions, not one: a single sleep could be explained by
      // a held-open request, two cannot.
      await step.sleep("cooldown_a", `${Math.ceil(sleepSeconds / 2)} seconds`);
      await step.do("after_first_sleep", async () => {
        await attempt("after_first_sleep");
        await done("after_first_sleep", { woke: true });
        return { woke: true };
      });
      await step.sleep("cooldown_b", `${Math.floor(sleepSeconds / 2)} seconds`);
    }

    const objectives = await step.do("generate_objectives", async () => {
      await attempt("generate_objectives");
      const result = { objectives: outline.sections * 2 };
      await done("generate_objectives", result);
      return result;
    });

    // The flaky step. `retry` succeeds on attempt 3; `fail` never succeeds and
    // exhausts the budget.
    const blocks = await step.do(
      "generate_blocks",
      { retries: { limit: 3, delay: "1 second", backoff: "constant" }, timeout: "30 seconds" },
      async () => {
        const attemptNo = await attempt("generate_blocks");
        if (scenario === "fail") {
          throw new Error("generate_blocks: deliberate permanent failure");
        }
        if (scenario === "retry" && attemptNo < 3) {
          throw new Error(`generate_blocks: deliberate transient failure (attempt ${attemptNo})`);
        }
        const result = { blocks: outline.pages * 3, attempts: attemptNo };
        await done("generate_blocks", result);
        return result;
      }
    );

    const validated = await step.do("assemble_and_validate", async () => {
      await attempt("assemble_and_validate");
      const result = {
        specSchemaVersion: "0.0.0-spike",
        blocks: blocks.blocks,
        objectives: objectives.objectives,
        valid: true,
      };
      await done("assemble_and_validate", result);
      return result;
    });

    return { scenario, source, outline, objectives, blocks, validated };
  }
}
