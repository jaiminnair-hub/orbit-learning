import { withAuth } from "@/lib/api/with-auth";
import { successResponse } from "@/lib/api/response";
import { isCourseBuilderConfigured } from "@/lib/ai/course-builder";

/**
 * Lets the "Generate with AI" panel show its unconfigured state before the
 * author has typed anything, rather than only after a submit fails. The
 * create route below re-checks the same thing server-side regardless — this
 * is a UX convenience, not the authorization boundary.
 */
export const GET = withAuth(
  async () => successResponse({ configured: isCourseBuilderConfigured() }),
  { minRole: "org_admin" }
);
