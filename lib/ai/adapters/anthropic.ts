import Anthropic from "@anthropic-ai/sdk";
import type { AdapterRequest, AdapterResponse, ProviderAdapter } from "../types";

/**
 * Anthropic adapter.
 *
 * Everything provider-specific is absorbed here, per
 * docs/PHASE3_AI_ARCHITECTURE.md §6: the structured-output mechanism, the
 * prompt shape, the error taxonomy. Feature code sees none of it, and the
 * gateway sees only `AdapterResponse`.
 */
export class AnthropicAdapter implements ProviderAdapter {
  readonly name = "anthropic";
  readonly supportsNativeStructuredOutput = true;

  private client: Anthropic | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  private getClient(): Anthropic {
    // Constructed lazily so importing the module in an environment with no
    // key — every test run, and any deployment with AI disabled — is free.
    if (!this.client) this.client = new Anthropic();
    return this.client;
  }

  async generate(request: AdapterRequest): Promise<AdapterResponse> {
    const { target, instruction, source, jsonSchema, repairFeedback } = request;

    const response = await this.getClient().messages.create(
      {
        model: target.model,
        max_tokens: target.maxOutputTokens,
        // Adaptive thinking: generation quality on structure-heavy output is
        // exactly what it helps with, and the fixed-budget form is rejected
        // on current models.
        thinking: { type: "adaptive" },
        system: instruction,
        // Native structured output, so the model is constrained to the schema
        // rather than merely asked for it.
        output_config: { format: { type: "json_schema", schema: jsonSchema } },
        messages: [
          {
            role: "user",
            // The delimiter is the structural half of §7's injection control:
            // source text arrives as clearly-marked data, never as a peer of
            // the instruction. The schema constraint is the other half — an
            // injected instruction cannot produce a valid document that does
            // something else, because the schema has no field expressing it.
            content: [
              {
                type: "text",
                text: `<source_material>\n${source}\n</source_material>${
                  repairFeedback
                    ? `\n\n<validation_errors>\nYour previous response did not satisfy the schema:\n${repairFeedback}\n</validation_errors>`
                    : ""
                }`,
              },
            ],
          },
        ],
      },
      { signal: request.signal, timeout: target.timeoutMs }
    );

    // A safety decline is a real outcome, not an exception — it arrives as a
    // 200 with stop_reason "refusal", so it has to be checked before content.
    if (response.stop_reason === "refusal") {
      throw new Error(
        `Provider declined the request (${response.stop_details?.category ?? "unspecified"}).`
      );
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    if (!text) throw new Error("Provider returned no text content.");

    return {
      text,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    };
  }
}
