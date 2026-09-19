import { NextResponse } from "next/server";

// Standard envelope, every route — see docs/API_SPEC.md §2. No route
// returns a bare array or a raw error string.
export function successResponse<T>(data: T, init?: number | ResponseInit) {
  return NextResponse.json(
    { data, meta: { requestId: crypto.randomUUID() } },
    typeof init === "number" ? { status: init } : init
  );
}

// `details` is optional and additive (Phase 3 step 6): a rejected spec edit
// has to tell the editor *which* findings blocked it, or the author is left
// with "invalid" and nowhere to click. Callers that don't pass it get the
// exact envelope they always did.
export function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        requestId: crypto.randomUUID(),
        ...(details === undefined ? {} : { details }),
      },
    },
    { status }
  );
}
