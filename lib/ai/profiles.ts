import type { ProfileConfig, ProviderTarget, WorkloadProfile } from "./types";

/**
 * Profile → provider chain, per docs/PHASE3_AI_ARCHITECTURE.md §3.
 *
 * This file is the *only* place a model name appears in the platform. Swapping
 * a model, reordering a fallback chain, or adding a provider is a change here
 * and nowhere else — which is what §6's "add a provider: new adapter + config
 * entry, no feature code changes" actually requires in practice.
 *
 * Per-org overrides are reserved but not implemented (§3): an enterprise tenant
 * may later require a specific provider for data residency. `resolveProfile`
 * already takes the org id so that becoming real is a body change, not a
 * signature change through every caller.
 */

const ANTHROPIC_OPUS: Omit<ProviderTarget, "maxOutputTokens" | "timeoutMs"> = {
  provider: "anthropic",
  model: "claude-opus-5",
  costPerMTokIn: 5,
  costPerMTokOut: 25,
};

const ANTHROPIC_HAIKU: Omit<ProviderTarget, "maxOutputTokens" | "timeoutMs"> = {
  provider: "anthropic",
  model: "claude-haiku-4-5",
  costPerMTokIn: 1,
  costPerMTokOut: 5,
};

/**
 * AICredits (https://aicredits.in) — an INR-billed gateway used as the
 * primary provider so this platform doesn't need a direct Anthropic account,
 * per the user's explicit choice. `lib/ai/adapters/aicredits.ts` has the full
 * rationale for why it's a genuinely different adapter, not a base-URL swap.
 *
 * **Verified 2026-08-26 with a real request against a real, funded key**
 * (a standalone script, not this codebase — see the request/response pairs
 * this comment is transcribed from). Two things worth recording:
 *
 * - `anthropic/claude-opus-5` returned 404 `model_not_found` — AICredits'
 *   catalog had not onboarded it yet, though it's a real current Anthropic
 *   model. `anthropic/claude-opus-4.6` is the highest-tier Opus their
 *   catalog actually serves right now; re-check `GET
 *   https://api.aicredits.in/api/models` periodically in case that catches up.
 * - `costPerMTokIn`/`costPerMTokOut` are real, computed from the verified
 *   response's `usage.cost_details` (INR), converted at an approximate
 *   ₹87/USD and rounded *up* to the next whole dollar — deliberately
 *   conservative so the budget guard (`lib/ai/budget.ts`) never undercounts
 *   real spend, not because the underlying INR figures themselves are
 *   estimates. Real ₹/M figures at verification time: Opus 4.6 ₹567 in /
 *   ₹2,834 out; Haiku 4.5 ₹113 in / ₹567 out.
 */
const AICREDITS_OPUS: Omit<ProviderTarget, "maxOutputTokens" | "timeoutMs"> = {
  provider: "aicredits",
  model: "anthropic/claude-opus-4.6",
  costPerMTokIn: 7,
  costPerMTokOut: 33,
};

const AICREDITS_HAIKU: Omit<ProviderTarget, "maxOutputTokens" | "timeoutMs"> = {
  provider: "aicredits",
  model: "anthropic/claude-haiku-4-5",
  costPerMTokIn: 2,
  costPerMTokOut: 7,
};

/**
 * The deterministic in-process adapter. Last in every chain on purpose: it is
 * what lets the whole pipeline be exercised in tests and local development
 * without credentials, and it costs nothing. It never runs when a real
 * provider is configured, because the chain only advances on failure.
 */
const ECHO: ProviderTarget = {
  provider: "echo",
  model: "echo-1",
  maxOutputTokens: 8192,
  timeoutMs: 5_000,
  costPerMTokIn: 0,
  costPerMTokOut: 0,
};

/** Fills in the per-call limits a chain entry needs beyond its provider/model/cost. */
function withLimits(
  base: Omit<ProviderTarget, "maxOutputTokens" | "timeoutMs">,
  maxOutputTokens: number,
  timeoutMs: number
): ProviderTarget {
  return { ...base, maxOutputTokens, timeoutMs };
}

const PROFILES: Record<WorkloadProfile, ProfileConfig> = {
  // High reasoning, low volume, latency-tolerant. AICredits first — the
  // user's chosen primary provider — with the direct Anthropic adapter as a
  // fallback that costs nothing while ANTHROPIC_API_KEY stays unset (an
  // unconfigured adapter is skipped, never called, per lib/ai/gateway.ts).
  course_outline: {
    chain: [
      withLimits(AICREDITS_OPUS, 16_000, 120_000),
      withLimits(ANTHROPIC_OPUS, 16_000, 120_000),
      ECHO,
    ],
    maxRepairAttempts: 2,
  },
  // Medium reasoning, high volume.
  content_expansion: {
    chain: [
      withLimits(AICREDITS_OPUS, 16_000, 120_000),
      withLimits(ANTHROPIC_OPUS, 16_000, 120_000),
      ECHO,
    ],
    maxRepairAttempts: 2,
  },
  // High precision and structured — the profile most worth repairing.
  item_generation: {
    chain: [
      withLimits(AICREDITS_OPUS, 16_000, 120_000),
      withLimits(ANTHROPIC_OPUS, 16_000, 120_000),
      ECHO,
    ],
    maxRepairAttempts: 3,
  },
  // Low reasoning, high volume, cheap.
  rewrite_localize: {
    chain: [
      withLimits(AICREDITS_HAIKU, 8_000, 60_000),
      withLimits(ANTHROPIC_HAIKU, 8_000, 60_000),
      ECHO,
    ],
    maxRepairAttempts: 1,
  },
  // Cheapest available.
  classification: {
    chain: [
      withLimits(AICREDITS_HAIKU, 2_000, 30_000),
      withLimits(ANTHROPIC_HAIKU, 2_000, 30_000),
      ECHO,
    ],
    maxRepairAttempts: 1,
  },
  // Reserved for the Phase 4 Tutor; defined so nothing has to invent it later.
  chat_stream: {
    chain: [
      withLimits(AICREDITS_OPUS, 16_000, 120_000),
      withLimits(ANTHROPIC_OPUS, 16_000, 120_000),
      ECHO,
    ],
    maxRepairAttempts: 0,
  },
};

/**
 * `orgId` is accepted and deliberately unused: it is the seam per-org profile
 * overrides land on, and having it here from day one means adding them never
 * touches a caller.
 */
export function resolveProfile(profile: WorkloadProfile, orgId?: string | null): ProfileConfig {
  // orgId is the seam per-org overrides land on; referenced so the parameter
  // is a real part of the contract rather than lint-suppressed decoration.
  void orgId;
  return PROFILES[profile];
}

export function allProfiles(): WorkloadProfile[] {
  return Object.keys(PROFILES) as WorkloadProfile[];
}

/** USD for one call, from the target's own published rates. */
export function computeCostUsd(target: ProviderTarget, tokensIn: number, tokensOut: number): number {
  const cost = (tokensIn / 1_000_000) * target.costPerMTokIn + (tokensOut / 1_000_000) * target.costPerMTokOut;
  // ai_usage_log.cost_usd is numeric(10,6); rounding here keeps the stored
  // value and the computed one identical rather than silently truncated.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
