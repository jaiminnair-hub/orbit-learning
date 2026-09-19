import { getSessionContext, type SessionContext } from "@/lib/auth/session";
import { hasRole, type Role } from "@/lib/auth/roles";
import { errorResponse } from "@/lib/api/response";
import type { Limiter } from "@/lib/ratelimit";

type RouteHandler<RouteCtx extends object = object> = (
  request: Request,
  ctx: { session: SessionContext } & RouteCtx
) => Promise<Response>;

type StaticRouteContext = {
  params: Promise<Record<string, string | string[] | undefined>>;
};

// Thin per-route opt-in wrapper — see docs/API_SPEC.md §1/§4. Resolves
// session once via getSessionContext() (same function the route-group
// layouts use, so pages and API routes share one source of truth), then
// checks the role hierarchy at the API layer as defense in depth. RLS
// enforces the real data boundary regardless — this check exists so a
// disallowed request gets a clean 401/403 before it ever reaches the
// database, not because RLS can't be trusted on its own.
//
// RouteCtx carries whatever Next.js's own route context is for this route
// (e.g. `{ params: Promise<{ id: string }> }` for a dynamic segment, per
// Next 16's route.ts convention — verified against
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
// rather than assumed) — passed through untouched.
export function withAuth<RouteCtx extends object = StaticRouteContext>(
  handler: RouteHandler<RouteCtx>,
  options?: { minRole?: Role; rateLimit?: Limiter }
) {
  return async function (request: Request, routeCtx: RouteCtx): Promise<Response> {
    const session = await getSessionContext();

    if (!session) {
      return errorResponse("UNAUTHENTICATED", "Sign in required.", 401);
    }

    if (options?.minRole && !hasRole(session.role, options.minRole)) {
      return errorResponse(
        "FORBIDDEN",
        `Requires at least the '${options.minRole}' role.`,
        403
      );
    }

    // Keyed by user id, not IP: the session is already resolved here, so
    // this is a free upgrade over an anonymous per-IP bucket, and it's
    // what actually matters for cost-bearing routes (a shared office IP
    // uploading many legitimate SCORM packages shouldn't collide with
    // an abusive single account).
    if (options?.rateLimit) {
      const result = await options.rateLimit.limit(session.userId);
      if (!result.success) {
        return errorResponse(
          "RATE_LIMITED",
          "Too many requests. Please wait before trying again.",
          429
        );
      }
    }

    return handler(request, { session, ...routeCtx });
  };
}
