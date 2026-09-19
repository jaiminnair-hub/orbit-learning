import type { AdapterRequest, AdapterResponse, ProviderAdapter } from "../types";

/**
 * A deterministic, in-process adapter.
 *
 * It exists so the gateway — routing, fallback, the repair loop, budget
 * enforcement, usage logging — can be exercised end to end with no
 * credentials, no network, and no cost. Everything the gateway promises is
 * provider-independent, so proving it against a real provider would prove the
 * provider, not the gateway.
 *
 * It builds a minimal instance of the requested JSON Schema rather than
 * returning canned text, which is what makes it useful as the last rung of a
 * fallback chain in local development: the result validates, so the surface
 * being built is exercisable.
 */
export class EchoAdapter implements ProviderAdapter {
  readonly name = "echo";
  readonly supportsNativeStructuredOutput = true;

  /** Always available — that is the point of it. */
  isConfigured(): boolean {
    return true;
  }

  async generate(request: AdapterRequest): Promise<AdapterResponse> {
    if (request.signal?.aborted) throw new Error("Aborted");

    const text = JSON.stringify(synthesize(request.jsonSchema, request.source));
    return {
      text,
      // Rough but honest: the gateway logs these, and a fabricated large
      // number would make local cost figures meaningless.
      tokensIn: Math.ceil((request.instruction.length + request.source.length) / 4),
      tokensOut: Math.ceil(text.length / 4),
    };
  }
}

interface JsonSchemaNode {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  minItems?: number;
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

/**
 * Smallest value satisfying a schema node.
 *
 * Deliberately minimal: it fills required fields and nothing else, so a schema
 * the generator cannot satisfy fails loudly here rather than producing
 * plausible-looking output that hides the gap.
 */
function synthesize(schema: unknown, source: string, depth = 0): unknown {
  if (depth > 12 || !schema || typeof schema !== "object") return null;
  const node = schema as JsonSchemaNode;

  if (node.const !== undefined) return node.const;
  if (node.enum?.length) return node.enum[0];
  if (node.default !== undefined) return node.default;

  const branch = node.anyOf ?? node.oneOf;
  if (branch?.length) return synthesize(branch[0], source, depth + 1);

  switch (node.type) {
    case "object": {
      const out: Record<string, unknown> = {};
      const required = new Set(node.required ?? []);
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (required.has(key)) out[key] = synthesize(child, source, depth + 1);
      }
      return out;
    }
    case "array": {
      const count = Math.max(node.minItems ?? 1, 1);
      const item = node.items ?? {};
      return Array.from({ length: count }, () => synthesize(item, source, depth + 1));
    }
    case "string":
      // Echoing a slice of the source makes it obvious in local development
      // which input produced which output.
      return source.slice(0, 60) || "generated";
    case "number":
    case "integer":
      return node.minimum ?? 1;
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return null;
  }
}
