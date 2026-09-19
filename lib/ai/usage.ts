import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Usage logging — docs/AI_ARCHITECTURE.md §1 non-negotiable #3, inherited by
 * PHASE3_AI_ARCHITECTURE.md §8: **every call is logged, on both the success
 * and the failure branch**.
 *
 * Writes through the service-role client because `ai_usage_log` has no
 * policies for `authenticated` at all (20260814143000_rls_and_helpers.sql) —
 * it is an operational record, never client-writable.
 */

export interface UsageRecord {
  orgId: string | null;
  userId?: string | null;
  feature: string;
  provider: string;
  model: string | null;
  profile: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  success: boolean;
  errorMessage?: string | null;
  costUsd: number;
  retryCount: number;
  jobId?: string | null;
}

/**
 * Never throws.
 *
 * A generation that succeeded must not be reported as failed because the
 * audit write did — and a generation that failed must not have its real error
 * replaced by a logging error. Logging failures go to stderr, where the
 * platform's own observability picks them up.
 */
export async function logAiUsage(record: UsageRecord): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("ai_usage_log").insert({
      org_id: record.orgId,
      user_id: record.userId ?? null,
      feature: record.feature,
      provider: record.provider,
      model: record.model,
      profile: record.profile,
      tokens_in: record.tokensIn,
      tokens_out: record.tokensOut,
      latency_ms: record.latencyMs,
      success: record.success,
      // Truncated: a provider stack trace can be enormous, and the column is
      // for triage, not forensics.
      error_message: record.errorMessage ? record.errorMessage.slice(0, 2000) : null,
      cost_usd: record.costUsd,
      retry_count: record.retryCount,
      job_id: record.jobId ?? null,
    });
    if (error) console.error("[ai] usage log insert failed:", error.message);
  } catch (error) {
    console.error("[ai] usage log threw:", error instanceof Error ? error.message : error);
  }
}

/**
 * Total spend in the current calendar month, in USD. `orgId: null` reads the
 * shared platform pool (rows logged with no owning org, e.g. Insights
 * generation) rather than any specific org's spend.
 */
export async function monthToDateSpendUsd(orgId: string | null): Promise<number> {
  const admin = createAdminClient();
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  let query = admin.from("ai_usage_log").select("cost_usd").gte("created_at", startOfMonth.toISOString());
  query = orgId === null ? query.is("org_id", null) : query.eq("org_id", orgId);
  const { data, error } = await query;

  if (error) {
    // Fail closed is wrong here and fail open is wrong too, so this reports
    // the problem and lets the budget guard decide — see budget.ts, which
    // treats an unknown spend as a hard stop rather than a free pass.
    throw new Error(`Could not read spend for ${orgId ?? "the platform"}: ${error.message}`);
  }

  return (data ?? []).reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
}
