import { z } from "zod";
import { assertWithinBudget } from "./budget";
import { logAiUsage } from "./usage";

const AICREDITS_EMBEDDINGS_URL = "https://api.aicredits.in/v1/embeddings";
// AICredits' catalogue exposes both the provider-qualified and compatibility
// aliases, but the live /v1/embeddings endpoint currently accepts only this
// OpenAI-compatible alias (verified with the funded platform key 2026-09-04).
export const AICREDITS_EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
const COST_PER_MILLION_TOKENS_USD = 0.02;
const REQUEST_TIMEOUT_MS = 30_000;

const EmbeddingsResponse = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      embedding: z.array(z.number()),
    })
  ),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "PROVIDER_FAILED" | "INVALID_RESPONSE"
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export function isAICreditsEmbeddingsConfigured(): boolean {
  return Boolean(process.env.AICREDITS_API_KEY?.trim());
}

function costUsd(tokens: number): number {
  return Math.round(((tokens / 1_000_000) * COST_PER_MILLION_TOKENS_USD) * 1_000_000) / 1_000_000;
}

/**
 * The platform's one embedding path. It mirrors the generation gateway's
 * non-negotiables: explicit attribution, budget enforcement, bounded network
 * time, validated provider output, and a usage row on both success and
 * failure. It is not a second text-generation path.
 */
export async function embedTexts(params: {
  orgId: string;
  userId?: string;
  feature: string;
  texts: string[];
  signal?: AbortSignal;
}): Promise<number[][]> {
  const texts = params.texts.map((text) => text.trim());
  if (!texts.length || texts.some((text) => !text)) {
    throw new EmbeddingError("At least one non-empty passage is required.", "INVALID_RESPONSE");
  }

  const key = process.env.AICREDITS_API_KEY?.trim();
  if (!key) {
    throw new EmbeddingError(
      "AICredits embeddings are not configured. Add AICREDITS_API_KEY to enable Orbit Guide.",
      "NOT_CONFIGURED"
    );
  }

  await assertWithinBudget(params.orgId);

  const startedAt = Date.now();
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout;
  let tokensIn = 0;

  try {
    const response = await fetch(AICREDITS_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: AICREDITS_EMBEDDING_MODEL, input: texts }),
      signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 800);
      throw new EmbeddingError(
        `AICredits embeddings failed (${response.status}): ${detail || response.statusText}`,
        "PROVIDER_FAILED"
      );
    }

    const parsed = EmbeddingsResponse.safeParse(await response.json());
    if (!parsed.success) {
      throw new EmbeddingError(
        `AICredits returned an invalid embeddings response: ${parsed.error.issues[0]?.message ?? "unknown shape"}`,
        "INVALID_RESPONSE"
      );
    }

    const ordered = [...parsed.data.data].sort((a, b) => a.index - b.index);
    if (
      ordered.length !== texts.length ||
      ordered.some((item, index) => item.index !== index || item.embedding.length !== EMBEDDING_DIMENSIONS)
    ) {
      throw new EmbeddingError(
        `AICredits returned ${ordered.length} embeddings; expected ${texts.length} vectors of ${EMBEDDING_DIMENSIONS} dimensions.`,
        "INVALID_RESPONSE"
      );
    }

    tokensIn = parsed.data.usage?.prompt_tokens ?? parsed.data.usage?.total_tokens ?? 0;
    await logAiUsage({
      orgId: params.orgId,
      userId: params.userId,
      feature: params.feature,
      provider: "aicredits",
      model: AICREDITS_EMBEDDING_MODEL,
      profile: "embedding",
      tokensIn,
      tokensOut: 0,
      latencyMs: Date.now() - startedAt,
      success: true,
      costUsd: costUsd(tokensIn),
      retryCount: 0,
    });

    return ordered.map((item) => item.embedding);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logAiUsage({
      orgId: params.orgId,
      userId: params.userId,
      feature: params.feature,
      provider: "aicredits",
      model: AICREDITS_EMBEDDING_MODEL,
      profile: "embedding",
      tokensIn,
      tokensOut: 0,
      latencyMs: Date.now() - startedAt,
      success: false,
      errorMessage: message,
      costUsd: costUsd(tokensIn),
      retryCount: 0,
    });
    if (error instanceof EmbeddingError) throw error;
    throw new EmbeddingError(`AICredits embeddings failed: ${message}`, "PROVIDER_FAILED");
  }
}
