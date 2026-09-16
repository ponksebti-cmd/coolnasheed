/**
 * GET /analytics — the numbers.
 *
 *   ?view=public   (default)  the charts: trending, the daily curve, the tag cloud
 *   ?view=song&song=<id>      one nasheed's play history
 *   ?view=admin               the staff dashboard — JWT checked against profiles.role
 *
 * The public half is cached for a minute at the edge, because charts that are sixty
 * seconds old are indistinguishable from live ones and cost a fraction of the queries.
 * The admin half is never cached: it is per-request, staff-only, and must not be able
 * to leak from one caller to the next through a cache key.
 *
 * Every read carries a deadline and degrades on its own: a dashboard whose daily curve
 * timed out still renders its totals, with the missing series empty rather than the
 * whole page failing.
 */

import { anonClient, hasServiceKey, optional, serviceClient, withTimeout } from "../_shared/db.ts";
import { cachedJson } from "../_shared/cache.ts";
import { HttpError, serve } from "../_shared/json.ts";
import { requireCaller, requireStaff } from "../_shared/auth.ts";
import type { AdminSummary, DailyPoint, SongStats, TrendingRow } from "../../../shared/types.ts";

const CHARTS_SECONDS = 60;

async function publicCharts(window: string, days: number, wantTags: boolean) {
  const db = hasServiceKey() ? serviceClient() : anonClient();
  const [trending, curve, tags] = await Promise.all([
    optional(
      withTimeout(db.rpc("trending", { p_window: window, p_limit: 20 }), 6000, "trending"),
      6000,
      { data: [] as TrendingRow[], error: null },
    ),
    optional(
      withTimeout(db.rpc("daily_curve", { p_days: days }), 6000, "daily_curve"),
      6000,
      { data: [] as DailyPoint[], error: null },
    ),
    wantTags
      ? optional(
          withTimeout(
            db.from("songs").select("tags").eq("status", "live").limit(500),
            5000,
            "songs.tags",
          ),
          5000,
          { data: [] as { tags: string[] | null }[], error: null },
        )
      : Promise.resolve({ data: [] as { tags: string[] | null }[], error: null }),
  ]);

  const counts = new Map<string, number>();
  for (const row of (tags.data ?? []) as { tags: string[] | null }[]) {
    for (const tag of row.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  return {
    window,
    days,
    trending: (trending.data ?? []) as TrendingRow[],
    daily: (curve.data ?? []) as DailyPoint[],
    tags: [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 40),
    generatedAt: Date.now(),
  };
}

async function songStats(songId: string): Promise<SongStats> {
  if (!songId || songId.length > 64) throw new HttpError("Which nasheed?", 400, "song");
  const db = hasServiceKey() ? serviceClient() : anonClient();
  const { data, error } = await withTimeout(db.rpc("song_stats", { p_song_id: songId }), 6000, "song_stats");
  if (error) throw new HttpError("Those numbers would not load.", 502);
  const stats = (data ?? {}) as Partial<SongStats>;
  return {
    plays: Number(stats.plays ?? 0),
    listeners: Number(stats.listeners ?? 0),
    seconds: Number(stats.seconds ?? 0),
    completed: Number(stats.completed ?? 0),
    daily: stats.daily ?? [],
  };
}

async function dashboard(req: Request, days: number): Promise<AdminSummary | Response> {
  // requireStaff throws 401/403 before anything is read
  const caller = await requireStaff(req);
  const db = hasServiceKey() ? serviceClient() : caller.client;
  const { data, error } = await withTimeout(
    db.rpc("admin_summary", { p_days: days }),
    12_000,
    "admin_summary",
  );
  if (error) {
    if (/staff-only/i.test(error.message)) throw new HttpError("That is a staff-only page.", 403);
    if (/does not exist/i.test(error.message)) {
      throw new HttpError("This project has no tables yet — the backend is not set up.", 503, "schema");
    }
    throw new HttpError("The dashboard would not load.", 502);
  }
  return (data ?? {}) as AdminSummary;
}

Deno.serve(
  serve(["GET"], async ({ req, url }) => {
    const view = (url.searchParams.get("view") ?? "public").toLowerCase();
    const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? "14") || 14, 1), 90);
    const window = ["24h", "7d", "30d", "all"].includes(url.searchParams.get("window") ?? "")
      ? url.searchParams.get("window")!
      : "7d";

    if (view === "admin") {
      const summary = await dashboard(req, days);
      if (summary instanceof Response) return summary;
      return Response.json(summary, { headers: { "cache-control": "no-store" } });
    }

    if (view === "song") {
      return Response.json(await songStats(url.searchParams.get("song") ?? ""), {
        headers: { "cache-control": "public, max-age=30, s-maxage=60" },
      });
    }

    if (view === "me") {
      const caller = await requireCaller(req);
      const { data, error } = await withTimeout(caller.client.rpc("my_history", { p_limit: 40 }), 6000, "my_history");
      if (error) throw new HttpError("Your history would not load.", 502);
      return Response.json({ history: data ?? [] }, { headers: { "cache-control": "no-store" } });
    }

    return await cachedJson(
      req,
      "charts",
      `${window}:${days}`,
      CHARTS_SECONDS,
      () => publicCharts(window, days, true),
    );
  }, { timeoutMs: 15_000 }),
);
