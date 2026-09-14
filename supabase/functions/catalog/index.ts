/**
 * GET /catalog — the whole catalogue, one call, cached for a minute.
 *
 * This is the only endpoint the app needs in order to draw a home page: publishers,
 * nasheeds, shelves and the tag cloud, assembled by `catalog_payload()` in Postgres.
 *
 * Why a function and not a direct `supabase.rpc("catalog_payload")` from the browser?
 * Because the Cache API sits in front of it. A thousand visitors in a minute cost one
 * database query instead of a thousand, which is the difference between a free tier
 * that lasts and one that does not. The client falls back to the RPC directly if this
 * function is not deployed, so nothing here is load-bearing.
 */

import { anonClient } from "../_shared/db.ts";
import { cached } from "../_shared/cache.ts";
import { fail, json, serve } from "../_shared/json.ts";
import type { CatalogResponse } from "../../../shared/types.ts";

const CACHE_SECONDS = 60;

async function build(): Promise<Response> {
  const db = anonClient();
  const { data, error } = await db.rpc("catalog_payload");
  if (error) return fail(`The catalogue would not load: ${error.message}`, 502);
  if (!data) return fail("The catalogue is empty.", 502);

  const payload = data as unknown as CatalogResponse;
  return json(
    {
      ...payload,
      artists: payload.artists ?? [],
      songs: payload.songs ?? [],
      collections: payload.collections ?? [],
      tags: payload.tags ?? [],
    },
    { cacheSeconds: CACHE_SECONDS },
  );
}

Deno.serve(
  serve(["GET"], async (_req, url) => {
    // ?fresh=1 skips the cache, which is what the studio calls after publishing
    if (url.searchParams.get("fresh") === "1") return build();
    return cached("catalog", "", CACHE_SECONDS, build);
  }),
);
