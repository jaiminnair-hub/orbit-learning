import { z } from "zod";
import { AiCreditsAdapter } from "./adapters/aicredits";
import { AnthropicAdapter } from "./adapters/anthropic";
import { EchoAdapter } from "./adapters/echo";
import { assertWithinBudget } from "./budget";
import { computeCostUsd, resolveProfile } from "./profiles";
import { logAiUsage } from "./usage";
import {
  AiGatewayError,
  type AdapterResponse,
  type GenerateStructuredRequest,
  type GenerateStructuredResult,
  type ProviderAdapter,
  type ProviderTarget,
  type WorkloadProfile,
} from "./types";

/**
 * The AI gateway — docs/PHASE3_AI_ARCHITECTURE.md §2–§4.
 *
 * `generateStructured` is the only generation primitive Phase 3 features use.
 * It resolves a workload profile to a provider chain, calls down the chain on
 * failure, validates the result against the caller's schema, runs a bounded
 * repair loop on validation failure, and logs every attempt — success and
 * failure alike.
 *
 * What it deliberately never does: coerce, patch, or partially accept output.
 * §4 is explicit that code-side coercion hides model weakness and yields
 * content that validates but is semantically wrong. Either the model produces
 * something that satisfies the schema within the retry budget, or the call
 * fails with the findings attached.
 */

const ADAPTERS: Record<string, ProviderAdapter> = {
  anthropic: new AnthropicAdapter(),
  aicredits: new AiCreditsAdapter(),
  echo: new EchoAdapter(),
};

/** Test seam: swap an adapter without touching the registry's shape. */
export function registerAdapter(name: string, adapter: ProviderAdapter): void {
  ADAPTERS[name] = adapter;
}

export function getAdapter(name: string): ProviderAdapter | undefined {
  return ADAPTERS[name];
}

/**
 * Whether a *real* provider is configured for a profile — deliberately
 * distinct from "is there a usable chain", which is always true because
 * `echo` is always configured and sits at the end of every chain.
 *
 * `echo` exists to exercise the gateway itself in tests and local
 * development, never to stand in for AI in a product surface. A feature that
 * needs to tell a user "AI generation is not configured" (rather than
 * silently succeeding against echo's synthesized output) checks this first.
 */
export function isRealProviderConfigured(profile: WorkloadProfile = "course_outline"): boolean {
  const config = resolveProfile(profile);
  return config.chain.some((target) => target.provider !== "echo" && ADAPTERS[target.provider]?.isConfigured());
}

export async function generateStructured<T>(
  request: GenerateStructuredRequest<T>
): Promise<GenerateStructuredResult<T>> {
  const { profile, schema, instruction, source, orgId, userId, feature, jobId, signal } = request;

  await assertWithinBudget(orgId);

  const config = resolveProfile(profile, orgId);
  // `io: "input"` matches lib/spec/json-schema.ts: the model is producing a
  // document to be parsed, so it must satisfy the schema's *input* shape —
  // the output shape has defaults already applied and would understate what
  // the model actually has to supply.
  //
  // `reused: "ref"` is load-bearing, not cosmetic — see the identical note
  // on lib/spec/json-schema.ts's `emit()`, which this call independently
  // duplicates rather than shares (this function accepts an arbitrary Zod
  // schema from any caller, not just lib/spec's own). Measured directly: the
  // `pageBlocks` generation schema emits at 11.2 MB without this option
  // (Zod inlines every repeated sub-schema instead of `$ref`-ing one shared
  // `$defs` entry) and was rejected outright by a real provider — AICredits
  // returned `413 Payload Too Large` calling this exact path, 2026-08-26,
  // the first time this function was ever exercised against a real provider
  // at all. With the option: 49 KB for the identical schema.
  const jsonSchema = z.toJSONSchema(schema, { io: "input", reused: "ref" }) as Record<string, unknown>;

  const usable = config.chain.filter((target) => ADAPTERS[target.provider]?.isConfigured());
  if (usable.length === 0) {
    throw new AiGatewayError(
      `No configured provider for profile '${profile}'.`,
      "NO_PROVIDER_CONFIGURED",
      { tried: config.chain.map((t) => t.provider) }
    );
  }

  const failures: Array<{ provider: string; model: string; error: string }> = [];

  for (const target of usable) {
    const adapter = ADAPTERS[target.provider]!;
    const outcome = await attemptTarget({
      adapter,
      target,
      schema,
      jsonSchema,
      instruction,
      source,
      maxRepairAttempts: config.maxRepairAttempts,
      profile,
      feature,
      orgId,
      userId,
      jobId,
      signal,
    });

    if (outcome.ok) return { data: outcome.data, meta: outcome.meta };
    failures.push({ provider: target.provider, model: target.model, error: outcome.error });

    // A cancelled request is the caller's decision, not a provider failure —
    // moving to the next rung would ignore it.
    if (outcome.cancelled) {
      throw new AiGatewayError("Generation was cancelled.", "CANCELLED", { failures });
    }
  }

  throw new AiGatewayError(
    `Every provider for profile '${profile}' failed.`,
    failures.every((f) => f.error.startsWith("VALIDATION:")) ? "VALIDATION_FAILED" : "ALL_PROVIDERS_FAILED",
    { failures }
  );
}

interface AttemptArgs<T> {
  adapter: ProviderAdapter;
  target: ProviderTarget;
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  instruction: string;
  source: string;
  maxRepairAttempts: number;
  profile: string;
  feature: string;
  orgId: string | null;
  userId?: string;
  jobId?: string;
  signal?: AbortSignal;
}

type AttemptOutcome<T> =
  | { ok: true; data: T; meta: GenerateStructuredResult<T>["meta"] }
  | { ok: false; error: string; cancelled: boolean };

/** One provider, plus its repair attempts. */
async function attemptTarget<T>(args: AttemptArgs<T>): Promise<AttemptOutcome<T>> {
  const { adapter, target, schema, jsonSchema, instruction, source, maxRepairAttempts } = args;

  let repairFeedback: string | undefined;
  let lastError = "unknown";
  let repairs = 0;

  // One initial attempt, then up to `maxRepairAttempts` corrections.
  for (let attempt = 0; attempt <= maxRepairAttempts; attempt++) {
    const startedAt = Date.now();
    let response: AdapterResponse | null = null;
    let errorMessage: string | null = null;

    try {
      response = await adapter.generate({
        target,
        instruction,
        source,
        jsonSchema,
        repairFeedback,
        signal: args.signal,
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    const latencyMs = Date.now() - startedAt;
    const tokensIn = response?.tokensIn ?? 0;
    const tokensOut = response?.tokensOut ?? 0;

    // Logged before any early return, so the failure branch is never the one
    // that goes unrecorded.
    await logAiUsage({
      orgId: args.orgId,
      userId: args.userId,
      feature: args.feature,
      provider: target.provider,
      model: target.model,
      profile: args.profile,
      tokensIn,
      tokensOut,
      latencyMs,
      success: false, // corrected below once the result is known to validate
      errorMessage,
      costUsd: computeCostUsd(target, tokensIn, tokensOut),
      retryCount: attempt,
      jobId: args.jobId,
    }).catch(() => {});

    if (!response) {
      lastError = errorMessage ?? "provider call failed";
      const cancelled = args.signal?.aborted === true || /abort/i.test(lastError);
      if (cancelled) return { ok: false, error: lastError, cancelled: true };
      // A transport or provider error is not repairable by feeding schema
      // errors back — move to the next provider rather than burn the repair
      // budget re-asking a provider that is down.
      return { ok: false, error: lastError, cancelled: false };
    }

    const parsed = parseAndValidate(schema, response.text);
    if (parsed.ok) {
      await logAiUsage({
        orgId: args.orgId,
        userId: args.userId,
        feature: args.feature,
        provider: target.provider,
        model: target.model,
        profile: args.profile,
        tokensIn,
        tokensOut,
        latencyMs,
        success: true,
        costUsd: computeCostUsd(target, tokensIn, tokensOut),
        retryCount: attempt,
        jobId: args.jobId,
      }).catch(() => {});

      return {
        ok: true,
        data: parsed.data,
        meta: {
          provider: target.provider,
          model: target.model,
          attempts: attempt + 1,
          repairs,
          tokensIn,
          tokensOut,
          latencyMs,
          costUsd: computeCostUsd(target, tokensIn, tokensOut),
          usedNativeStructuredOutput: adapter.supportsNativeStructuredOutput,
        },
      };
    }

    // Feed the validator's own errors back — never a hand-written hint, so
    // the model is corrected against the same contract it will be judged by.
    repairFeedback = parsed.errors;
    lastError = `VALIDATION: ${parsed.errors}`;
    repairs = attempt + 1;
  }

  return { ok: false, error: lastError, cancelled: false };
}

type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: string };

function parseAndValidate<T>(schema: z.ZodType<T>, text: string): ParseResult<T> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(extractJson(text));
  } catch {
    return { ok: false, errors: "Response was not valid JSON." };
  }

  const result = schema.safeParse(candidate);
  if (result.success) return { ok: true, data: result.data };

  return {
    ok: false,
    errors: result.error.issues
      .slice(0, 20)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n"),
  };
}

/**
 * Pulls the JSON object out of a response.
 *
 * Providers with native structured output return bare JSON; those without may
 * wrap it in prose or a fenced block. Absorbing that here rather than in each
 * adapter keeps §4 step 2's "the difference is the adapter's problem" true
 * for the *call*, while the parsing quirk stays in one place.
 */
function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  const firstBrace = trimmed.search(/[{[]/);
  if (firstBrace >= 0) {
    const lastBrace = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}
