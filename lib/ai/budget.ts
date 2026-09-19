import { AiGatewayError } from "./types";
import { monthToDateSpendUsd } from "./usage";

/**
 * Per-org cost guard — docs/PHASE3_AI_ARCHITECTURE.md §7 and §8.
 *
 * The rule that shapes this file: on budget exhaustion, **fail clearly, never
 * silently downgrade to a cheaper model**. A platform that quietly swaps
 * models when an org runs low makes quality vary for reasons no author can
 * see or explain, which is worse than an honest refusal.
 */

const DEFAULT_MONTHLY_BUDGET_USD = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 50);
// One article a day at content_expansion's own ceiling costs cents, not
// dollars — this just bounds a runaway cron (e.g. misconfigured schedule)
// the same way an org's budget bounds a runaway admin.
const PLATFORM_MONTHLY_BUDGET_USD = Number(process.env.AI_PLATFORM_MONTHLY_BUDGET_USD ?? 20);

export interface BudgetStatus {
  spentUsd: number;
  limitUsd: number;
  remainingUsd: number;
}

/** `orgId: null` checks the shared platform pool (see monthToDateSpendUsd). */
export async function getBudgetStatus(orgId: string | null): Promise<BudgetStatus> {
  const spentUsd = await monthToDateSpendUsd(orgId);
  const limitUsd = orgId === null ? PLATFORM_MONTHLY_BUDGET_USD : DEFAULT_MONTHLY_BUDGET_USD;
  return { spentUsd, limitUsd, remainingUsd: Math.max(0, limitUsd - spentUsd) };
}

/**
 * Throws when the org has nothing left to spend.
 *
 * Note what this does *not* do: it does not estimate the cost of the call it
 * is about to authorise and refuse a call that would cross the line
 * mid-flight. Token counts are not knowable before generation, and refusing
 * on a guess would reject work that would have fit. The line is therefore
 * crossed by at most one call, which is bounded by the profile's own output
 * ceiling.
 *
 * A spend read that *fails* is treated as exhausted rather than unlimited:
 * the alternative is that a database problem silently removes the only
 * cost control the platform has.
 */
export async function assertWithinBudget(orgId: string | null): Promise<BudgetStatus> {
  let status: BudgetStatus;
  try {
    status = await getBudgetStatus(orgId);
  } catch (error) {
    throw new AiGatewayError(
      orgId === null
        ? "Could not confirm the platform's AI budget, so the request was refused."
        : "Could not confirm this organisation's AI budget, so the request was refused.",
      "BUDGET_EXCEEDED",
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }

  if (status.remainingUsd <= 0) {
    throw new AiGatewayError(
      `${orgId === null ? "The platform" : "This organisation"} has used its AI budget for the month ($${status.spentUsd.toFixed(2)} of $${status.limitUsd.toFixed(2)}).`,
      "BUDGET_EXCEEDED",
      status
    );
  }

  return status;
}
