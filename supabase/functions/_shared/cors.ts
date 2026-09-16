/**
 * CORS.
 *
 * Functions are called from a browser, so every response carries these headers and
 * every preflight is answered before any work happens.
 *
 * `ALLOWED_ORIGINS` (a comma-separated list) restricts who may read a response from a
 * page; when it is unset the origin is echoed back, which is safe here because no
 * response is secret and authentication travels in the Authorization header rather
 * than a cookie. Credentials are never allowed, so a wildcard cannot become a
 * cross-site request forgery.
 */

const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export function originFor(req: Request): string {
  const origin = req.headers.get("origin") ?? "";
  if (!origin) return "*";
  if (ALLOWED.length === 0) return origin;
  return ALLOWED.includes(origin.replace(/\/+$/, "")) ? origin : ALLOWED[0]!;
}

export function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": originFor(req),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-nasheed-client, idempotency-key",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "x-request-id, etag, retry-after, x-nasheed-cache",
    "Access-Control-Max-Age": "86400",
    "Vary": "origin",
  };
}

/** Answer an OPTIONS preflight. No database read, no auth check, no rate limit. */
export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
