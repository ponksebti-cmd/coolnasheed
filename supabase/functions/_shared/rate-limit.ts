/**
 * Rate limiting.
 *
 * A small token bucket per key, held in the isolate's memory. It is deliberately
 * honest about what it is: an edge isolate is one of many, so the limit is per
 * isolate, not global. That is enough to stop the two things that actually hurt a
 * free-tier project — a retry loop and a script hammering a write endpoint — without
 * a Redis, a database round trip, or a shared counter that would cost more than the
 * request it protects.
 *
 * Keys are `<name>:<ip>` or `<name>:<user id>`, never a token.
 */

type Bucket = { tokens: number; updatedAt: number };

const REQUEST_BUCKETS = new Map<string, Bucket>();
const WRITE_BUCKETS = new Map<string, Bucket>();

/** Cap the map so a long-lived isolate cannot grow without bound. */
const MAX_KEYS = 5000;

function take(
  store: Map<string, Bucket>,
  key: string,
  capacity: number,
  windowSeconds: number,
): { allowed: boolean; retryAfter: number; remaining: number } {
  const now = Date.now();
  const refillPerMs = capacity / (windowSeconds * 1000);
  const bucket = store.get(key) ?? { tokens: capacity, updatedAt: now };

  const refilled = Math.min(capacity, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
  if (refilled < 1) {
    const missing = 1 - refilled;
    const retryAfter = Math.ceil(missing / refillPerMs / 1000);
    store.set(key, { tokens: refilled, updatedAt: now });
    return { allowed: false, retryAfter: Math.max(1, retryAfter), remaining: 0 };
  }

  const tokens = refilled - 1;
  store.set(key, { tokens, updatedAt: now });
  if (store.size > MAX_KEYS) {
    for (const [oldest] of store) {
      store.delete(oldest);
      if (store.size <= MAX_KEYS / 2) break;
    }
  }
  return { allowed: true, retryAfter: 0, remaining: Math.floor(tokens) };
}

/** ~120 requests a minute, burstable — generous for a person, tight for a script. */
export function readLimit(key: string) {
  return take(REQUEST_BUCKETS, key, 120, 60);
}

/** ~20 writes a minute, burstable. Publishing, moderating, deleting. */
export function writeLimit(key: string) {
  return take(WRITE_BUCKETS, key, 20, 60);
}
