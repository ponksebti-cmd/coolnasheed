/**
 * Structured logs.
 *
 * One JSON line per event, so Supabase's function log viewer can be searched by
 * `requestId` and a failing request can be traced across the functions that touched
 * it. Nothing here logs a token, an email address or a lyric.
 */

export type LogFields = Record<string, unknown>;

const SECRET = /(token|authorization|apikey|password|secret|jwt)/i;

function scrub(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SECRET.test(key) ? "[redacted]" : value;
  }
  return out;
}

function emit(level: "info" | "warn" | "error", event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...scrub(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};

export function requestId(req: Request): string {
  const incoming = req.headers.get("x-request-id");
  if (incoming && /^[\w-]{6,64}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

/** The caller's IP, as far as the platform reports it. Used for rate limiting only. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim().slice(0, 45);
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown";
}
