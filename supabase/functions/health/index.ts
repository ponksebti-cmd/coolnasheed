/**
 * GET /health — is the backend actually there?
 *
 * The client calls this once at boot when it has credentials, and shows the answer on
 * the staff dashboard. It is deliberately boring and deliberately cheap: a handful of
 * counted rows, the storage total, and whether the seeded catalogue is present. It is
 * the page you look at when the app says "demo mode" and you want to know why.
 */

import { anonClient, hasServiceKey, PROJECT_REF, serviceClient } from "../_shared/db.ts";
import { cached } from "../_shared/cache.ts";
import { json, serve } from "../_shared/json.ts";
import { ARTWORK_BUCKET, AUDIO_BUCKET, type HealthResponse } from "../../../shared/types.ts";

const VERSION = "1.0.0";

async function build(): Promise<Response> {
  const started = Date.now();
  const admin = hasServiceKey() ? serviceClient() : anonClient();

  const [profiles, songs, comments, events, buckets, artists, authProbe] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("songs").select("id", { count: "exact", head: true }),
    admin.from("comments").select("id", { count: "exact", head: true }),
    admin.from("play_events").select("id", { count: "exact", head: true }),
    admin.storage.listBuckets(),
    admin.from("profiles").select("id").eq("kind", "artist").eq("verified", true).limit(1),
    // a reachable auth service answers "user not found" for a made-up id; an
    // unreachable one throws something else entirely. That is the whole test.
    admin.auth.getUser("00000000-0000-0000-0000-000000000000"),
  ]);

  let storageBytes = 0;
  for (const bucket of [AUDIO_BUCKET, ARTWORK_BUCKET]) {
    const { data } = await admin.storage.from(bucket).list("", { limit: 1000 });
    for (const file of data ?? []) {
      const size = (file.metadata as { size?: number } | null)?.size;
      if (typeof size === "number") storageBytes += size;
    }
  }

  const names = (buckets.data ?? []).map((b) => b.name);
  const body: HealthResponse = {
    ok: !profiles.error && !songs.error,
    version: VERSION,
    driver: "supabase",
    project: PROJECT_REF,
    checks: {
      database: !profiles.error,
      storage: names.includes(AUDIO_BUCKET) && names.includes(ARTWORK_BUCKET),
      auth: /not found|invalid/i.test(authProbe.error?.message ?? ""),
      seed: (artists.data ?? []).length > 0,
    },
    counts: {
      profiles: profiles.count ?? 0,
      songs: songs.count ?? 0,
      comments: comments.count ?? 0,
      playEvents: events.count ?? 0,
    },
    storageBytes,
    tookMs: Date.now() - started,
  };

  return json(body, { cacheSeconds: 30, status: body.ok ? 200 : 503 });
}

Deno.serve(
  serve(["GET", "HEAD"], async (_req, url) => {
    if (url.searchParams.get("fresh") === "1") return build();
    return cached("health", "", 30, build);
  }),
);
