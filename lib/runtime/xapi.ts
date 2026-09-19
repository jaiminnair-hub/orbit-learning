import type { XapiEffect, XapiVerb } from "./types";

/**
 * Converts an interpreter effect into a storable xAPI statement body, per
 * the verb table in docs/PHASE3_API_EVENTS.md §7.2. Statement construction
 * lives here rather than in the engine because it needs actor/session
 * context the pure interpreter never sees.
 */

const VERB_IDS: Record<XapiVerb, string> = {
  initialized: "http://adlnet.gov/expapi/verbs/initialized",
  terminated: "http://adlnet.gov/expapi/verbs/terminated",
  progressed: "http://adlnet.gov/expapi/verbs/progressed",
  experienced: "http://adlnet.gov/expapi/verbs/experienced",
  answered: "http://adlnet.gov/expapi/verbs/answered",
  completed: "http://adlnet.gov/expapi/verbs/completed",
  passed: "http://adlnet.gov/expapi/verbs/passed",
  failed: "http://adlnet.gov/expapi/verbs/failed",
  interacted: "http://adlnet.gov/expapi/verbs/interacted",
};

export interface StatementContext {
  specId: string;
  specTitle: string;
  registration: string;
}

export interface XapiStatement {
  id: string;
  actor: { objectType: "Agent"; mbox: string };
  verb: { id: string; display: { "en-US": string } };
  object: { id: string; objectType: "Activity"; definition: { name: { "en-US": string } } };
  result?: { success?: boolean; completion?: boolean; score?: { scaled: number }; response?: string };
  context: { registration: string };
  timestamp: string;
}

// `actor` is a placeholder here — the server route
// (app/api/v1/runtime/xapi/statements/route.ts) overwrites it from the
// authenticated session unconditionally before storing, so a learner's
// client can never assert someone else's identity in stored telemetry.
export function buildStatement(effect: XapiEffect, ctx: StatementContext): XapiStatement {
  return {
    id: crypto.randomUUID(),
    actor: { objectType: "Agent", mbox: "mailto:self" },
    verb: { id: VERB_IDS[effect.verb], display: { "en-US": effect.verb } },
    object: {
      id: `urn:lms:course-specification:${ctx.specId}${effect.objectId ? `:${effect.objectId}` : ""}`,
      objectType: "Activity",
      definition: { name: { "en-US": ctx.specTitle } },
    },
    result: effect.result
      ? {
          success: effect.result.success,
          completion: effect.result.completion,
          score: effect.result.scorePercent !== undefined ? { scaled: effect.result.scorePercent / 100 } : undefined,
          response: effect.result.response,
        }
      : undefined,
    context: { registration: ctx.registration },
    timestamp: new Date().toISOString(),
  };
}
