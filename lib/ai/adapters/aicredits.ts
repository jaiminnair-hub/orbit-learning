import type { AdapterRequest, AdapterResponse, ProviderAdapter } from "../types";

/**
 * AICredits adapter — https://aicredits.in, an INR-billed gateway in front
 * of 300+ models (including Claude), used here so this platform doesn't need
 * a direct Anthropic account. Requested by the user as the primary provider,
 * the same way it's already used on a separate, unrelated project — that
 * project's code is off-limits to this one (docs/ARCHITECTURE.md §2's hard
 * separation rule), so this is built fresh from AICredits' own public docs
 * (https://aicredits.in/docs/api-reference), not copied from anywhere.
 *
 * This is genuinely a different shape from `./anthropic.ts`, not a
 * find-and-replace of the base URL: AICredits exposes only an
 * OpenAI-compatible `POST /v1/chat/completions`, never Anthropic's native
 * `/v1/messages` — so Anthropic-only features the other adapter uses
 * (adaptive extended thinking, native `output_config` JSON-schema
 * constraining) have no equivalent here.
 *
 * `supportsNativeStructuredOutput` is deliberately `false`. AICredits' own
 * documented example for structured output shows only the weaker
 * `{"type": "json_object"}` mode (valid JSON, not schema-constrained) — there
 * is no confirmed evidence a `json_schema` passthrough would actually be
 * enforced upstream rather than silently accepted and ignored. Per
 * docs/PHASE3_AI_ARCHITECTURE.md §4 step 2 ("falling back to schema-in-prompt
 * plus extraction where [native structured output] is not [supported] — this
 * difference is the adapter's problem, never the feature's"), the schema is
 * embedded directly in the system prompt instead, and the gateway's own
 * validate-then-repair loop (which runs regardless of this flag) does the
 * real enforcement.
 */
export class AiCreditsAdapter implements ProviderAdapter {
  readonly name = "aicredits";
  readonly supportsNativeStructuredOutput = false;

  isConfigured(): boolean {
    return Boolean(process.env.AICREDITS_API_KEY);
  }

  async generate(request: AdapterRequest): Promise<AdapterResponse> {
    const { target, signal } = request;
    const body = buildChatCompletionsRequest(request);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, target.timeoutMs);
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener("abort", onExternalAbort);

    let response: Response;
    try {
      response = await fetch("https://api.aicredits.in/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.AICREDITS_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // A timeout and a genuine external cancellation both abort the same
      // controller, but the gateway's own cancellation detection greps the
      // error message for "abort" (lib/ai/gateway.ts) — a timeout must not
      // match that, or a slow response would stop the whole fallback chain
      // instead of advancing to the next provider like any other failure.
      if (timedOut) throw new Error(`AICredits request timed out after ${target.timeoutMs}ms.`);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onExternalAbort);
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(`AICredits request failed (${response.status}): ${extractErrorMessage(raw, response.status)}`);
    }

    const data = (await response.json()) as ChatCompletionsResponse;
    const choice = data.choices?.[0];

    // OpenAI-shaped declines surface as a finish_reason rather than a
    // distinct response field the way Anthropic's `stop_reason: "refusal"` does.
    if (choice?.finish_reason === "content_filter") {
      throw new Error("Provider declined the request (content filter).");
    }

    const text = choice?.message?.content ?? "";
    if (!text) throw new Error("Provider returned no text content.");

    return {
      text,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
    };
  }
}

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Pure and exported so the request shape is testable without a network call. */
export function buildChatCompletionsRequest(request: AdapterRequest): Record<string, unknown> {
  const { target, instruction, source, jsonSchema, repairFeedback } = request;

  // The schema travels inside the *system* message (trusted, authored by
  // us), never concatenated with `source` — the same instruction/source
  // separation docs/PHASE3_AI_ARCHITECTURE.md §7 requires stays intact even
  // though this adapter, unlike the Anthropic one, has to fold the schema
  // into a prompt rather than a dedicated structured-output field.
  const systemPrompt = [
    instruction,
    "",
    "Respond with a single JSON object that satisfies exactly this JSON Schema. Output only the JSON — no prose, no markdown code fences, no keys beyond what the schema allows.",
    JSON.stringify(jsonSchema),
  ].join("\n");

  // Delimited exactly as the Anthropic adapter delimits it: untrusted source
  // text arrives as clearly-marked data, and repair feedback (the gateway's
  // own validator output, not user input) rides alongside it rather than in
  // the system message, matching the existing adapter's shape.
  const userContent = `<source_material>\n${source}\n</source_material>${
    repairFeedback
      ? `\n\n<validation_errors>\nYour previous response did not satisfy the schema:\n${repairFeedback}\n</validation_errors>`
      : ""
  }`;

  return {
    model: target.model,
    max_tokens: target.maxOutputTokens,
    temperature: target.temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  };
}

function extractErrorMessage(rawBody: string, status: number): string {
  try {
    const parsed = JSON.parse(rawBody) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Body wasn't JSON — fall through to the generic message.
  }
  return `status ${status}`;
}
