import type { z } from "zod";

/**
 * The gateway's contract — docs/PHASE3_AI_ARCHITECTURE.md §2–§4.
 *
 * Non-negotiable #1 is that no provider or model name reaches feature code.
 * That is enforced here by shape, not by convention: `generateStructured`
 * takes a **profile**, and there is no parameter anywhere in this file through
 * which a caller could name a model even if it wanted to.
 */

/** Workload profiles from §3. Each maps to an ordered provider/model chain. */
export const WORKLOAD_PROFILES = [
  "course_outline",
  "content_expansion",
  "item_generation",
  "rewrite_localize",
  "classification",
  "chat_stream",
] as const;

export type WorkloadProfile = (typeof WORKLOAD_PROFILES)[number];

/** One rung of a profile's fallback chain. */
export interface ProviderTarget {
  provider: string;
  model: string;
  maxOutputTokens: number;
  temperature?: number;
  timeoutMs: number;
  /** USD per million tokens, for cost attribution. */
  costPerMTokIn: number;
  costPerMTokOut: number;
}

export interface ProfileConfig {
  /** Tried in order; the next is used only when the previous fails. */
  chain: ProviderTarget[];
  /** Bounded repair attempts after a validation failure (§4 step 4). */
  maxRepairAttempts: number;
}

/**
 * What an adapter is handed.
 *
 * `instruction` and `source` are separate fields and stay separate all the way
 * to the provider. That is the structural half of the prompt-injection control
 * in §7: untrusted source text is never concatenated into the instruction, so
 * "ignore previous instructions" arrives as data inside a delimited block
 * rather than as a peer of the system prompt.
 */
export interface AdapterRequest {
  target: ProviderTarget;
  /** Trusted, authored by us. */
  instruction: string;
  /** Untrusted. Document text, author prompt, prior model output. */
  source: string;
  /** The shape the provider must return, as a JSON Schema object. */
  jsonSchema: Record<string, unknown>;
  /** Validator errors from the previous attempt, when repairing. */
  repairFeedback?: string;
  signal?: AbortSignal;
}

export interface AdapterResponse {
  /** Raw text the provider returned; the gateway parses and validates it. */
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export interface ProviderAdapter {
  readonly name: string;
  /**
   * True when the provider can constrain output to a schema natively. The
   * gateway does not care which — §4 step 2 makes this the adapter's problem,
   * never the feature's — but it is logged, because a silent switch from
   * native to prompted extraction changes output quality.
   */
  readonly supportsNativeStructuredOutput: boolean;
  /** Resolves whether credentials are actually present, without calling out. */
  isConfigured(): boolean;
  generate(request: AdapterRequest): Promise<AdapterResponse>;
}

export class AiGatewayError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NO_PROVIDER_CONFIGURED"
      | "ALL_PROVIDERS_FAILED"
      | "VALIDATION_FAILED"
      | "BUDGET_EXCEEDED"
      | "CANCELLED",
    readonly details?: unknown
  ) {
    super(message);
    this.name = "AiGatewayError";
  }
}

export interface GenerateStructuredRequest<T> {
  profile: WorkloadProfile;
  /** Zod schema — the same primitive lib/spec uses, so generation and the editor agree. */
  schema: z.ZodType<T>;
  instruction: string;
  source: string;
  /**
   * For logging and budget attribution. `null` for platform-level generation
   * with no owning org (e.g. Insights articles) — tracked against a shared
   * platform budget rather than any org's, per lib/ai/budget.ts.
   */
  orgId: string | null;
  userId?: string;
  /** Names the calling feature in ai_usage_log, e.g. "authoring.outline". */
  feature: string;
  /** Correlates every call in one generation job (§8). */
  jobId?: string;
  signal?: AbortSignal;
}

export interface GenerateMeta {
  provider: string;
  model: string;
  attempts: number;
  repairs: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costUsd: number;
  usedNativeStructuredOutput: boolean;
}

export interface GenerateStructuredResult<T> {
  data: T;
  meta: GenerateMeta;
}
