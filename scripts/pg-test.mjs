/**
 * The migrations, the seed and Row Level Security, run against a real Postgres.
 *
 * There is no Docker here and no `supabase start`, and SQL that has never met a
 * database is SQL that has never been tested — 2,700 lines of it, about to be pasted
 * into somebody's live project. So this runs it for real: PGlite is Postgres compiled
 * to WebAssembly, the same planner, the same trigger machinery, the same RLS.
 *
 * What it shims, because PGlite is Postgres and not Supabase:
 *
 *   auth.users, auth.uid(), auth.jwt(), auth.role()   — read from the request GUCs
 *     exactly the way Supabase's do, so `set_config('request.jwt.claims', …)` plus
 *     `set role authenticated` is a faithful stand-in for a browser with a JWT
 *   storage.buckets / storage.objects                 — the columns the policies use
 *   roles anon / authenticated / service_role
 *
 * What it does not shim: pg_cron and the realtime publication, both of which the
 * migrations wrap in `do … exception when others` precisely so their absence is not
 * fatal. This run is the proof that those blocks behave.
 *
 *   node scripts/pg-test.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const ROOT = process.cwd();
const MIGRATIONS = readdirSync(join(ROOT, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const SEED = join(ROOT, "supabase/seed.sql");

/* ------------------------------------------------------------------ reporting */

let checks = 0;
const failures = [];
const green = (t) => `\x1b[32m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const dim = (t) => `\x1b[2m${t}\x1b[0m`;

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

function check(label, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`  ${green("✓")} ${label}${detail ? dim(` — ${detail}`) : ""}`);
  else {
    failures.push(detail ? `${label}: ${detail}` : label);
    console.log(`  ${red(`✗ ${label}`)}${detail ? dim(` — ${detail}`) : ""}`);
  }
  return Boolean(condition);
}

/** Run something that should be refused, and say what it was refused with. */
async function refused(label, fn, wantCode) {
  try {
    const result = await fn();
    // a statement that "succeeds" by touching nothing is also a refusal
    if (result && typeof result.affectedRows === "number" && result.affectedRows === 0) {
      return check(label, true, "0 rows");
    }
    return check(label, false, `it was allowed — ${JSON.stringify(result?.rows?.[0] ?? result ?? null).slice(0, 120)}`);
  } catch (err) {
    const code = err?.code ?? "";
    if (wantCode && code !== wantCode) return check(label, false, `refused with ${code || err.message}, wanted ${wantCode}`);
    return check(label, true, `${code} ${String(err.message).split("\n")[0].slice(0, 90)}`);
  }
}

/* -------------------------------------------------------------- the supabase shim */

const SHIM = `
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

do $$
begin
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
exception when duplicate_object then
  null;
end
$$;

create table if not exists auth.users (
  id                     uuid primary key default gen_random_uuid(),
  email                  text unique,
  encrypted_password     text not null default '',
  email_confirmed_at     timestamptz,
  raw_app_meta_data      jsonb default '{}'::jsonb,
  raw_user_meta_data     jsonb default '{}'::jsonb,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now(),
  role                   text default 'authenticated'
);

-- the real definitions read the same two GUCs PostgREST sets from the JWT
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  ), '')::uuid
$$;

create or replace function auth.role()
returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'anon'
  )
$$;

create or replace function auth.jwt()
returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null default '',
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id              uuid primary key default gen_random_uuid(),
  bucket_id       text references storage.buckets (id) on delete cascade,
  name            text,
  owner           uuid,
  version         text,
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

create policy "buckets are readable" on storage.buckets for select to anon, authenticated using (true);

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant select on auth.users to postgres;

-- the platform grants these on a real project; the policies in migration 4 assume them
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
`;

/* ------------------------------------------------------------------------ boot */

const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });

async function sql(query, params) {
  return params ? db.query(query, params) : db.query(query);
}

/** The single value of a one-row, one-column query. */
async function one(query, params) {
  const { rows } = await sql(query, params);
  const first = rows[0] ?? {};
  const value = Object.values(first)[0];
  return value;
}

/** Become a role, with the JWT claims PostgREST would have set for it. */
async function asRole(role, claims = {}) {
  await sql("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role, ...claims })]);
  await sql("select set_config('request.jwt.claim.sub', $1, false)", [claims.sub ?? ""]);
  await sql("select set_config('request.jwt.claim.role', $1, false)", [role === "postgres" ? "" : role]);
  await db.exec(role === "postgres" ? "reset role" : `set role ${role}`);
}

const asAnon = () => asRole("anon", { role: "anon" });
const asUser = (sub) => asRole("authenticated", { sub, role: "authenticated" });
const asPostgres = () => asRole("postgres", {});

let exitCode = 0;
let aborted = null;

try {
  console.log(`\x1b[1mCoolNasheed · the database, run for real\x1b[0m ${dim("(Postgres in WebAssembly)")}`);

  section("The Supabase shim");
  await db.exec(SHIM);
  check("auth, storage and the three roles exist", (await one("select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')")) === 3);

  section("Migrations");
  for (const name of MIGRATIONS) {
    const body = readFileSync(join(ROOT, "supabase/migrations", name), "utf8");
    try {
      await db.exec(body);
      check(name, true);
    } catch (err) {
      check(name, false, String(err.message).split("\n")[0]);
    }
  }

  section("Seed");
  const seed = readFileSync(SEED, "utf8");
  try {
    await db.exec(seed);
    check("supabase/seed.sql applies", true);
  } catch (err) {
    check("supabase/seed.sql applies", false, String(err.message).split("\n")[0]);
  }

  /* ------------------------------------------------------------- the schema */

  section("Shape of the schema");
  const EXPECTED_TABLES = [
    "amens", "collections", "comments", "follows", "loves", "play_events", "playlists",
    "profiles", "reports", "reserved_handles", "saved_collections", "site_stats_daily",
    "song_stats_daily", "songs",
  ];
  const tables = (await sql("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.tablename);
  const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
  check("all 14 tables exist", missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : tables.length + " in public");

  const noRls = (await sql(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1
  `)).rows.map((r) => r.relname);
  check("row level security is on for every table", noRls.length === 0, noRls.length ? `off: ${noRls.join(", ")}` : "");

  const policies = Number(await one("select count(*) from pg_policies where schemaname = 'public'"));
  check("the policies are all there", policies >= 40, `${policies} in public`);

  const buckets = (await sql("select id, public, file_size_limit from storage.buckets order by id")).rows;
  check("two public buckets, with their limits", buckets.length === 2
    && buckets[0].id === "nasheed-artwork" && Number(buckets[0].file_size_limit) === 8388608
    && buckets[1].id === "nasheed-audio" && Number(buckets[1].file_size_limit) === 62914560,
    buckets.map((b) => `${b.id} ${b.file_size_limit}`).join(" · "));

  const rpcs = (await sql(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' order by 1
  `)).rows.map((r) => r.proname);
  const EXPECTED_RPCS = [
    "admin_summary", "catalog_payload", "daily_curve", "my_bootstrap", "my_history",
    "my_listening", "publisher_profile", "record_play", "report_comment",
    "resolve_report", "song_stats", "trending",
  ];
  const missingRpcs = EXPECTED_RPCS.filter((f) => !rpcs.includes(f));
  check("every RPC the client calls exists", missingRpcs.length === 0, missingRpcs.length ? `missing ${missingRpcs.join(", ")}` : `${EXPECTED_RPCS.length} of them`);

  /* ---------------------------------------------------------------- the seed */

  section("What the seed put in");
  const counts = (await sql(`
    select
      (select count(*) from public.profiles)                        as profiles,
      (select count(*) from public.profiles where kind = 'artist')  as artists,
      (select count(*) from public.songs)                           as songs,
      (select count(*) from public.collections)                     as collections,
      (select count(*) from public.comments)                        as comments,
      (select count(*) from public.follows)                         as follows,
      (select count(*) from public.loves)                           as loves,
      (select count(*) from public.amens)                           as amens,
      (select count(*) from public.reports)                         as reports,
      (select count(*) from public.song_stats_daily)                as song_days,
      (select count(*) from public.site_stats_daily)                as site_days
  `)).rows[0];
  check("24 nasheeds, 9 shelves, 144 notes", counts.songs === 24 && counts.collections === 9 && counts.comments === 144,
    `${counts.songs} songs · ${counts.collections} collections · ${counts.comments} comments · ${counts.amens} amens · ${counts.loves} loves · ${counts.follows} follows`);
  check("8 publishers and 16 listeners", counts.artists === 8 && counts.profiles === 24, `${counts.artists} artists · ${counts.profiles} profiles`);
  check("14 days of charts to read", counts.song_days > 200 && counts.site_days === 14, `${counts.song_days} song-days · ${counts.site_days} site-days`);

  const drift = Number(await one(`
    select count(*) from public.songs s
     where s.notes <> (select count(*) from public.comments c where c.song_id = s.id and not c.removed)
  `));
  check("songs.notes agrees with the notes that exist", drift === 0, drift ? `${drift} nasheeds out` : "counters kept by trigger, reconciled by seed");

  const likeDrift = Number(await one(`
    select count(*) from public.songs s
     where s.likes < (select count(*) from public.loves l where l.song_id = s.id)
  `));
  check("every seeded love is counted on its nasheed", likeDrift === 0, likeDrift ? `${likeDrift} behind` : "likes ≥ loves rows");

  section("And again — the seed is idempotent");
  await db.exec(seed);
  const after = Number(await one("select count(*) from public.songs"));
  const amensAfter = Number(await one("select count(*) from public.amens"));
  check("seeding twice changes nothing", after === 24 && amensAfter === counts.amens, `${after} songs · ${amensAfter} amens`);

  /* --------------------------------------------------------------- sign-up */

  section("Signing up (the auth trigger)");
  const firstId = await one("insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'first@listener.test', '{\"handle\":\"first.listener\",\"name\":\"First Listener\"}'::jsonb) returning id");
  const first = (await sql("select handle, name, role, kind from public.profiles where id = $1", [firstId])).rows[0];
  check("a profile appears with the handle that was asked for", first?.handle === "first.listener", JSON.stringify(first ?? null));
  check("and the first account on a fresh project is staff", first?.role === "staff", `role=${first?.role}`);

  const secondId = await one("insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'first@other.test', '{\"handle\":\"first.listener\"}'::jsonb) returning id");
  const second = (await sql("select handle, role from public.profiles where id = $1", [secondId])).rows[0];
  check("a taken handle is resolved, not refused", second?.handle !== "first.listener" && /^first\.listener\d{4}$/.test(second?.handle ?? ""), `handle=${second?.handle}`);
  check("and the second account is a listener", second?.role === "listener", `role=${second?.role}`);

  const signups = Number(await one("select coalesce(sum(signups),0) from public.site_stats_daily where day = (now() at time zone 'utc')::date"));
  check("signups land in the daily rollup", signups === 2, `${signups} today`);

  /* ------------------------------------------------------- the catalogue RPC */

  section("catalog_payload() — what the client hydrates from");
  await asAnon();
  const payload = (await sql("select public.catalog_payload() as payload")).rows[0]?.payload ?? {};
  const songs = payload.songs ?? [];
  const artists = payload.artists ?? [];
  const collections = payload.collections ?? [];
  const tags = payload.tags ?? [];
  check("24 nasheeds, publishers, shelves and tags", songs.length === 24 && artists.length >= 8 && collections.length === 9 && tags.length > 0,
    `${songs.length} songs · ${artists.length} artists · ${collections.length} collections · ${tags.length} tags`);

  const SONG_KEYS = ["id", "ownerId", "ownerHandle", "title", "titleAr", "note", "maqam", "root", "bpm", "voices",
    "duff", "duffEnter", "passes", "accent", "year", "tags", "lines", "motifBank", "audioPath", "audioMime",
    "durationMs", "artworkPath", "status", "publishedAt", "plays", "likes", "notes"];
  const songKeyGaps = SONG_KEYS.filter((k) => !(k in (songs[0] ?? {})));
  check("a nasheed arrives in camelCase with every key the app reads", songKeyGaps.length === 0,
    songKeyGaps.length ? `missing ${songKeyGaps.join(", ")}` : `${SONG_KEYS.length} keys`);

  const ARTIST_KEYS = ["id", "profileId", "name", "nameAr", "role", "origin", "bio", "seed", "accent", "verified"];
  const artistKeyGaps = ARTIST_KEYS.filter((k) => !(k in (artists[0] ?? {})));
  check("a publisher arrives with the keys artistFromCard reads", artistKeyGaps.length === 0,
    artistKeyGaps.length ? `missing ${artistKeyGaps.join(", ")}` : `${ARTIST_KEYS.length} keys`);

  const COLLECTION_KEYS = ["id", "kind", "title", "titleAr", "curator", "blurb", "seed", "accent", "tags", "year", "songIds"];
  const collectionKeyGaps = COLLECTION_KEYS.filter((k) => !(k in (collections[0] ?? {})));
  check("a shelf arrives with songIds the player can walk", collectionKeyGaps.length === 0 && Array.isArray(collections[0]?.songIds),
    collectionKeyGaps.length ? `missing ${collectionKeyGaps.join(", ")}` : `${collections[0]?.songIds?.length ?? 0} nasheeds on the first shelf`);

  check("tags arrive as {tag, count}", tags.every((t) => typeof t.tag === "string" && typeof Number(t.count) === "number"),
    tags.slice(0, 3).map((t) => `${t.tag}:${t.count}`).join(" "));

  const orphans = songs.filter((s) => !artists.some((a) => a.id === s.ownerHandle));
  check("every nasheed is credited to a publisher in the same payload", orphans.length === 0,
    orphans.length ? `${orphans.length} orphaned (${orphans[0].id} → ${orphans[0].ownerHandle})` : "");

  const lyricShape = songs.every((s) => Array.isArray(s.lines) && s.lines.every((l) => typeof l === "object" && (l.tr || l.ar || l.en)));
  const timed = songs.some((s) => s.lines.some((l) => typeof l.t === "number"));
  check("lyrics arrive as lines, with timings when the seed has them", lyricShape, timed ? "some lines carry t" : "no timings in the seed");
  check("nothing unpublished leaks", songs.every((s) => s.status === "live"), "");

  /* ------------------------------------------------------------ play beacon */

  section("record_play() — the analytics engine");
  const songId = songs[0].id;
  const playsBefore = Number(await one("select plays from public.songs where id = $1", [songId]));

  // the seed already wrote today's rollups, so what matters is the difference
  const rollupBefore = (await sql(`
    select coalesce(plays,0) as plays, coalesce(listeners,0) as listeners, coalesce(seconds,0) as seconds
      from public.song_stats_daily where song_id = $1 and day = (now() at time zone 'utc')::date`, [songId])).rows[0] ?? { plays: 0, listeners: 0, seconds: 0 };
  const siteBefore = (await sql(`
    select coalesce(plays,0) as plays, coalesce(listeners,0) as listeners, coalesce(signups,0) as signups
      from public.site_stats_daily where day = (now() at time zone 'utc')::date`)).rows[0] ?? { plays: 0, listeners: 0, signups: 0 };

  await asAnon();
  const p1 = (await sql("select public.record_play($1, 40, false, 'device-aaa') as r", [songId])).rows[0].r;
  const playsAfter = Number(await one("select plays from public.songs where id = $1", [songId]));
  check("a real listen counts", p1.ok === true && p1.counted === true, JSON.stringify(p1));
  check("and songs.plays actually moves", playsAfter === playsBefore + 1, `${playsBefore} → ${playsAfter} (the guard used to freeze this)`);

  const p2 = (await sql("select public.record_play($1, 40, false, 'device-aaa') as r", [songId])).rows[0].r;
  check("the same device five seconds later is a duplicate", p2.duplicate === true && p2.counted === false, JSON.stringify(p2));
  check("and it did not count twice", Number(await one("select plays from public.songs where id = $1", [songId])) === playsAfter);

  const p3 = (await sql("select public.record_play($1, 4, false, 'device-bbb') as r", [songId])).rows[0].r;
  check("four seconds is not a listen", p3.ok === true && p3.counted === false, JSON.stringify(p3));

  const p4 = (await sql("select public.record_play($1, 2, true, 'device-ccc') as r", [songId])).rows[0].r;
  check("finishing a nasheed counts, however short", p4.counted === true, JSON.stringify(p4));

  const gone = (await sql("select public.record_play('sng_not-here', 60, true, 'device-aaa') as r")).rows[0].r;
  check("a beacon for a nasheed that is not there says so", gone.ok === false && typeof gone.error === "string", JSON.stringify(gone));

  // the raw events are not anon-readable, so look at them as the database owner
  await asPostgres();
  check("but a short listen still leaves its event and its seconds",
    Number(await one("select count(*) from public.play_events where song_id = $1 and client_id = 'device-bbb'", [songId])) === 1
    && Number(await one("select seconds from public.play_events where song_id = $1 and client_id = 'device-bbb'", [songId])) === 4);

  const rollup = (await sql(`
    select plays, listeners, seconds from public.song_stats_daily
     where song_id = $1 and day = (now() at time zone 'utc')::date`, [songId])).rows[0];
  const dPlays = Number(rollup?.plays ?? 0) - Number(rollupBefore.plays);
  const dListeners = Number(rollup?.listeners ?? 0) - Number(rollupBefore.listeners);
  const dSeconds = Number(rollup?.seconds ?? 0) - Number(rollupBefore.seconds);
  check("the day's rollup kept up — three counted plays, three new listeners, 46 seconds",
    dPlays === 3 && dListeners === 3 && dSeconds === 46,
    `+${dPlays} plays · +${dListeners} listeners · +${dSeconds}s (now ${rollup?.plays}/${rollup?.listeners}/${rollup?.seconds})`);

  const site = (await sql(`
    select plays, listeners, signups from public.site_stats_daily where day = (now() at time zone 'utc')::date`)).rows[0];
  check("and so did the site's", Number(site?.plays ?? 0) - Number(siteBefore.plays) === 3
    && Number(site?.listeners ?? 0) - Number(siteBefore.listeners) === 3,
    `+${Number(site?.plays ?? 0) - Number(siteBefore.plays)} plays · +${Number(site?.listeners ?? 0) - Number(siteBefore.listeners)} listeners`);

  /* ----------------------------------------------------------- charts + rows */

  section("The read paths the pages use");
  await asAnon();
  const TRENDING_KEYS = ["song_id", "title", "accent", "maqam", "owner_name", "plays", "listeners", "seconds", "likes"];
  const trending = (await sql("select * from public.trending('7d', 10) limit 10")).rows ?? [];
  const trendingGaps = TRENDING_KEYS.filter((k) => !(k in (trending[0] ?? {})));
  check("trending() answers in the columns trendingFromRow reads", Array.isArray(trending) && trending.length > 0 && trendingGaps.length === 0,
    trendingGaps.length ? `missing ${trendingGaps.join(", ")}` : `${trending.length} rows, top is “${trending[0]?.title}”`);

  const DAILY_KEYS = ["day", "plays", "listeners", "signups"];
  const daily = (await sql("select * from public.daily_curve(14)")).rows ?? [];
  const dailyGaps = DAILY_KEYS.filter((k) => !(k in (daily[0] ?? {})));
  check("daily_curve() answers one row per day, zero-filled", daily.length === 14 && dailyGaps.length === 0,
    dailyGaps.length ? `missing ${dailyGaps.join(", ")}` : `${daily.length} days`);

  const stats = (await sql("select public.song_stats($1) as s", [songId])).rows[0].s ?? {};
  check("song_stats() answers plays, listeners, seconds, completed and a curve",
    ["plays", "listeners", "seconds", "completed", "daily"].every((k) => k in stats) && Array.isArray(stats.daily),
    `${stats.plays} plays · ${stats.listeners} listeners · ${stats.daily?.length ?? 0} days`);

  // my_history returns a jsonb array (trending and daily_curve return rows), which is
  // what supabase-js hands back either way — but the two are read differently here
  const history = (await sql("select public.my_history(30, 'device-aaa') as rows")).rows[0]?.rows ?? [];
  const HISTORY_KEYS = ["songId", "title", "accent", "ownerName", "plays", "seconds", "lastAt"];
  const historyGaps = HISTORY_KEYS.filter((k) => !(k in (history[0] ?? {})));
  check("my_history() answers camelCase rows for an anonymous device", history.length >= 1 && historyGaps.length === 0,
    historyGaps.length ? `missing ${historyGaps.join(", ")}` : `${history.length} rows`);

  const publisher = (await sql("select public.publisher_profile('yusuf') as p")).rows[0].p ?? {};
  check("publisher_profile() takes a handle",
    publisher?.user?.handle === "yusuf" && Array.isArray(publisher.songs) && typeof publisher.totals?.plays === "number" && typeof publisher.followers === "number",
    `${publisher?.user?.name} · ${publisher?.songs?.length ?? 0} nasheeds · ${publisher?.followers ?? 0} followers`);

  const publisherByUuid = (await sql("select public.publisher_profile($1) as p", [publisher?.user?.profileId ?? publisher?.user?.id])).rows[0].p ?? {};
  check("and it takes a uuid", publisherByUuid?.user?.handle === "yusuf", `${publisherByUuid?.user?.handle ?? "nothing"}`);

  /* ------------------------------------------------------------------- RLS */

  section("Row level security, as the three kinds of caller");
  const listenerA = await one("select id from public.profiles where kind = 'listener' and role = 'listener' order by created_at limit 1");
  const listenerB = await one("select id from public.profiles where kind = 'listener' and role = 'listener' order by created_at desc limit 1");
  const staffId = firstId;

  await asAnon();
  check("an anonymous listener reads the catalogue", Number(await one("select count(*) from public.songs")) === 24);
  check("and reads the notes under it", Number(await one("select count(*) from public.comments where not removed")) >= 144);
  // anon has no table-level grant on these at all, which is a stronger refusal than
  // a policy that returns nothing — and the client never reads them directly anyway,
  // it goes through my_history() and my_bootstrap(), which are definer
  await refused("but not who played what", () => sql("select count(*) from public.play_events"), "42501");
  await refused("nor whose sets they are", () => sql("select count(*) from public.playlists"), "42501");
  await refused("and cannot love a nasheed", () => sql("insert into public.loves (profile_id, song_id) values ($1, $2)", [listenerA, songId]), "42501");
  await refused("nor move a counter by hand", () => sql("update public.songs set plays = plays + 999 where id = $1", [songId]), "42501");

  await asUser(listenerA);
  const loved = await sql("insert into public.loves (profile_id, song_id) values ($1, $2) returning song_id", [listenerA, songId]);
  check("a listener may love a nasheed", loved.affectedRows === 1);
  const likesNow = Number(await one("select likes from public.songs where id = $1", [songId]));
  check("and the counter trigger moves it", likesNow === (songs[0].likes ?? 0) + 1, `${songs[0].likes} → ${likesNow}`);

  await refused("but cannot write the counter itself", () => sql("update public.songs set likes = 5000 where id = $1", [songId]), "42501");
  await refused("and cannot hand a nasheed to somebody else", () => sql("update public.songs set owner_id = $1 where id = $2", [listenerB, songId]), "42501");

  const unloved = await sql("delete from public.loves where profile_id = $1 and song_id = $2", [listenerA, songId]);
  check("un-loving is allowed", unloved.affectedRows === 1);
  check("and the counter follows it back down", Number(await one("select likes from public.songs where id = $1", [songId])) === (songs[0].likes ?? 0));

  const note = await sql(
    "insert into public.comments (song_id, author_id, text) values ($1, $2, 'Peace on this one.') returning id",
    [songId, listenerA],
  );
  const noteId = note.rows[0]?.id;
  check("a listener may leave a note", Boolean(noteId), String(noteId));
  check("and songs.notes counts it", Number(await one("select notes from public.songs where id = $1", [songId])) > 0);

  await asUser(listenerB);
  const amen = await sql("insert into public.amens (profile_id, comment_id) values ($1, $2) returning comment_id", [listenerB, noteId]);
  check("somebody else may say āmīn", amen.affectedRows === 1);
  const amensOnNote = Number(await one("select amens from public.comments where id = $1", [noteId]));
  check("and the note's āmīn counter moves", amensOnNote === 1, `${amensOnNote} (this used to be frozen too)`);

  await refused("another listener cannot edit that note", () => sql("update public.comments set text = 'rewritten' where id = $1", [noteId]), null);
  await refused("and cannot delete it", () => sql("delete from public.comments where id = $1", [noteId]), null);
  await refused("nor hide it", () => sql("update public.comments set removed = true where id = $1", [noteId]), null);
  check("hiding was refused, not silently undone", (await sql("select removed from public.comments where id = $1", [noteId])).rows[0].removed === false);

  await asUser(listenerA);
  const edited = await sql("update public.comments set text = 'Peace on this one, still.' where id = $1 returning edited_at", [noteId]);
  check("the author may edit their own note", edited.affectedRows === 1);
  check("and the edit is stamped, not hidden", Boolean(edited.rows[0]?.edited_at), String(edited.rows[0]?.edited_at ?? ""));
  // the profile guard reverts a privilege write rather than refusing it, so the
  // statement "succeeds" and changes nothing — which is what the next line checks
  await sql("update public.profiles set role = 'staff' where id = $1", [listenerA]);
  check("but cannot promote themselves — the guard puts the role back",
    (await sql("select role from public.profiles where id = $1", [listenerA])).rows[0].role === "listener");

  const set = await sql("insert into public.playlists (owner_id, name, song_ids) values ($1, 'Late night', $2) returning id", [listenerA, [songId]]);
  const setId = set.rows[0]?.id;
  check("a listener may build a set", Boolean(setId));
  await asUser(listenerB);
  check("and it stays theirs", Number(await one("select count(*) from public.playlists where id = $1", [setId])) === 0);

  /* ------------------------------------------------------- three reports hide */

  section("Three reports take a note off the page");
  const targetNote = String(await one("select id from public.comments where not removed and author_id <> $1 order by created_at limit 1", [staffId]));
  const reporters = (await sql("select id from public.profiles where id <> (select author_id from public.comments where id = $1) order by created_at limit 3", [targetNote])).rows.map((r) => r.id);
  for (const [i, reporter] of reporters.entries()) {
    await asUser(reporter);
    const reported = await sql("select public.report_comment($1, $2) as r", [targetNote, i === 0 ? "It is not what it says." : "Wrong words here."]);
    const state = (await asPostgres().then(() => sql("select removed, reports from public.comments where id = $1", [targetNote]))).rows[0];
    const shouldHide = i === 2;
    check(`report ${i + 1} of 3 ${shouldHide ? "takes the note off the page" : "leaves it up"}`,
      reported.rows[0].r.ok === true && state.removed === shouldHide,
      `reports=${state.reports} removed=${state.removed}`);
  }
  const hidden = (await sql("select removed, reports from public.comments where id = $1", [targetNote])).rows[0];
  check("the third report hides the note", hidden?.removed === true, `reports=${hidden?.reports} removed=${hidden?.removed}`);
  check("and the counter says why", Number(hidden?.reports) >= 3);

  await asPostgres();
  const openReportId = String((await sql("select id from public.reports where comment_id = $1 limit 1", [targetNote])).rows[0].id);

  await asUser(listenerA);
  const summaryRefusal = await (async () => {
    try {
      await sql("select public.admin_summary(14) as s");
      return false;
    } catch {
      return true;
    }
  })();
  check("a listener cannot read the staff dashboard", summaryRefusal);
  await refused("and cannot resolve a report", () => sql("select public.resolve_report($1, false) as r", [openReportId]), null);

  await asUser(staffId);
  const summary = (await sql("select public.admin_summary(14) as s")).rows[0].s ?? {};
  const SUMMARY_KEYS = ["totals", "daily", "topSongs", "topOwners", "reports", "recentSongs"];
  const summaryGaps = SUMMARY_KEYS.filter((k) => !(k in summary));
  check("staff read the dashboard", summaryGaps.length === 0, summaryGaps.length ? `missing ${summaryGaps.join(", ")}` : "");
  const TOTAL_KEYS = ["users", "artists", "songs", "removed", "plays", "listenSeconds", "notes", "likes", "amens", "reportsOpen", "storageBytes"];
  const totalGaps = TOTAL_KEYS.filter((k) => !(k in (summary.totals ?? {})));
  check("totals carry every number the dashboard prints", totalGaps.length === 0,
    totalGaps.length ? `missing ${totalGaps.join(", ")}` : `${summary.totals.users} users · ${summary.totals.songs} nasheeds · ${summary.totals.plays} plays`);
  check("the queue is in the summary", Array.isArray(summary.reports) && summary.reports.length >= 1, `${summary.reports?.length ?? 0} open`);

  const reportId = String((await sql("select id from public.reports where comment_id = $1 limit 1", [targetNote])).rows[0].id);
  const resolved = (await sql("select public.resolve_report($1, false) as r", [reportId])).rows[0].r;
  check("staff close a report", resolved && (resolved.ok === true || resolved.resolved === true), JSON.stringify(resolved ?? null));
  const back = (await sql("select removed from public.comments where id = $1", [targetNote])).rows[0];
  check("and closing a report as unfounded puts an auto-hidden note back", back?.removed === false, `removed=${back?.removed}`);

  /* ---------------------------------------------------------------- storage */

  section("Storage policies");
  await asUser(listenerA);
  const uploaded = await sql(
    "insert into storage.objects (bucket_id, name, owner) values ('nasheed-audio', $1, $2) returning name",
    [`${listenerA}/nasheed-test.mp3`, listenerA],
  );
  check("a publisher uploads into their own folder", uploaded.affectedRows === 1, uploaded.rows[0]?.name ?? "");
  await refused("but not into somebody else's", () => sql(
    "insert into storage.objects (bucket_id, name, owner) values ('nasheed-audio', $1, $2)",
    [`${listenerB}/stolen.mp3`, listenerA],
  ), "42501");
  await asAnon();
  check("an anonymous listener can read the file back", Number(await one(
    "select count(*) from storage.objects where bucket_id = 'nasheed-audio'",
  )) === 1);
  await asUser(listenerB);
  await refused("and cannot delete it", () => sql(
    "delete from storage.objects where name = $1", [`${listenerA}/nasheed-test.mp3`],
  ), null);

  /* ------------------------------------------------------------- the bypass */

  section("The guard bypass is not a client's to call");
  await asAnon();
  await refused("anon cannot set the marker", () => sql("select public.guard_bypass('because I said so')"), "42501");
  await asUser(listenerA);
  await refused("and neither can a listener", () => sql("select public.guard_bypass('because I said so')"), "42501");
  await asPostgres();
  await db.exec("begin");
  await sql("select public.guard_bypass('three reports')");
  const bypassed = (await sql("select public.guard_bypassed() as b")).rows[0].b;
  await db.exec("commit");
  check("while the definer trigger that owns it still can", bypassed === true, `guard_bypassed() = ${bypassed} inside the same transaction`);

  /* ------------------------------------------------- publishing without a door */

  section("Publishing straight through PostgREST (no Edge Function in the way)");
  await asUser(listenerA);
  const published = await sql(`
    insert into public.songs
      (owner_id, title, title_ar, note, maqam, root, bpm, voices, duff, duff_enter,
       passes, accent, year, tags, lines, duration_ms, status)
    values
      ($1, 'A Test of the Direct Road', 'اختبار', 'Published by a listener, straight to the table.',
       'bayati', 62, 84, 'solo', 'DT..DT..DT..DT..', 'verse', 2, 'gold', 2026,
       array['test','direct'],
       '[{"tr":"yā rabbi","en":"O my Lord","t":0}]'::jsonb,
       180000, 'live')
    returning id, plays, likes, notes`,
    [listenerA],
  );
  const publishedId = published.rows[0]?.id;
  check("a listener may publish their own nasheed", Boolean(publishedId), String(publishedId));
  check("and it starts with the counters the database owns at zero",
    published.rows[0]?.plays === 0 && published.rows[0]?.likes === 0 && published.rows[0]?.notes === 0,
    JSON.stringify(published.rows[0]));
  await refused("but cannot buy itself a play count", () => sql(
    "insert into public.songs (owner_id, title, note, maqam, root, bpm, voices, plays, likes, notes) values ($1, 'Bought', '', 'rast', 60, 80, 'solo', 999999, 999, 999)",
    [listenerA],
  ), "42501");

  await asUser(listenerB);
  await refused("and nobody else may edit it", () => sql("update public.songs set title = 'Mine now' where id = $1", [publishedId]), null);

  await asAnon();
  const publicCatalog = (await sql("select public.catalog_payload() as payload")).rows[0]?.payload ?? {};
  const mine = (publicCatalog.songs ?? []).find((x) => x.id === publishedId);
  check("the catalogue hands it to an anonymous listener", Boolean(mine), `${publicCatalog.songs?.length ?? 0} nasheeds now`);
  check("credited to the publisher's handle, not their uuid", mine?.ownerHandle === (await asPostgres().then(() => one("select handle from public.profiles where id = $1", [listenerA]))),
    `ownerHandle=${mine?.ownerHandle}`);
  check("with its lyrics intact", Array.isArray(mine?.lines) && mine.lines[0]?.tr === "yā rabbi", JSON.stringify(mine?.lines ?? null));

  await asUser(listenerA);
  const bootAfter = (await sql("select public.my_bootstrap() as b")).rows[0].b ?? {};
  check("and their own bootstrap counts it as published",
    Number(bootAfter.stats?.published) === 1 && (bootAfter.songs ?? []).some((x) => x.id === publishedId),
    `published=${bootAfter.stats?.published} songs=${bootAfter.songs?.length ?? 0}`);

  const counted = (await sql("select public.record_play($1, 60, true, 'device-ddd') as r", [publishedId])).rows[0].r;
  check("a play on a nasheed its owner published still counts", counted.counted === true && Number(counted.plays) === 1, JSON.stringify(counted));

  await asUser(listenerA);
  const taken = await sql("update public.songs set status = 'removed' where id = $1 returning status", [publishedId]);
  check("and its owner may take it down", taken.rows[0]?.status === "removed");
  await asAnon();
  const afterRemoval = (await sql("select public.catalog_payload() as payload")).rows[0]?.payload ?? {};
  check("after which the room cannot see it", !(afterRemoval.songs ?? []).some((x) => x.id === publishedId),
    `${afterRemoval.songs?.length ?? 0} nasheeds`);

  /* ------------------------------------------- the publish contract, in the table */

  section("The publish contract, against the real table");
  const fixture = JSON.parse(readFileSync(join(ROOT, "shared/fixtures/publish-cases.json"), "utf8"));
  const contractRows = fixture.cases.filter((c) => c.row);
  const refusedRows = [];
  await asUser(listenerA);
  for (const c of contractRows) {
    const r = c.row;
    try {
      // as the listener, not as the owner of the database: this is also the proof that
      // the column grants cover exactly what a publisher needs and nothing more
      await sql(`
        insert into public.songs
          (owner_id, title, title_ar, note, maqam, root, bpm, voices, duff, duff_enter, passes,
           accent, year, tags, lines, motif_bank, audio_path, audio_mime, audio_bytes,
           duration_ms, artwork_path)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::text[],$15::jsonb,$16::integer[],$17,$18,$19,$20,$21)`,
        [listenerA, r.title, r.title_ar, r.note, r.maqam, r.root, r.bpm, r.voices, r.duff,
         r.duff_enter, r.passes, r.accent, r.year, r.tags ?? [], JSON.stringify(r.lines ?? []),
         r.motif_bank, r.audio_path, r.audio_mime, r.audio_bytes, r.duration_ms, r.artwork_path]);
    } catch (err) {
      refusedRows.push(`${c.name}: ${String(err.message).split("\n")[0]}`);
    }
  }
  check(`all ${contractRows.length} rows the validators produce are rows Postgres accepts`,
    refusedRows.length === 0, refusedRows.length ? refusedRows.join(" · ") : "inserted under the column grants, as a listener");

  await asPostgres();
  // counted by owner and by title, because several cases share a title on purpose
  const titles = [...new Set(contractRows.map((c) => c.row.title))];
  const contractCount = Number(
    await one(`select count(*) from public.songs where owner_id = $1 and title = any($2::text[])`,
      [listenerA, titles]),
  );
  check("and they are all really in there", contractCount === contractRows.length,
    `${contractCount} of ${contractRows.length} rows owned by the listener`);

  /* ------------------------------------------------------------- following */

  section("Following a publisher");
  await asUser(listenerA);
  // somebody this listener has not followed yet — the seed already follows most of them
  const unfollowed = (await sql(`
    select a.id, a.handle from public.profiles a
     where a.kind = 'artist'
       and not exists (select 1 from public.follows f where f.profile_id = $1 and f.artist_id = a.id)
     limit 1`, [listenerA])).rows[0];
  const yusuf = unfollowed?.id;
  const followed = await sql("insert into public.follows (profile_id, artist_id) values ($1, $2) returning artist_id", [listenerA, yusuf]);
  check(`a listener may follow a publisher (${unfollowed?.handle})`, followed.affectedRows === 1);
  const asPublisher = (await sql("select public.publisher_profile($1) as p", [yusuf])).rows[0].p ?? {};
  check("and the publisher's page says so", asPublisher.youFollow === true, `youFollow=${asPublisher.youFollow} followers=${asPublisher.followers}`);
  await asUser(listenerB);
  const asOther = (await sql("select public.publisher_profile($1) as p", [yusuf])).rows[0].p ?? {};
  check("but only for the person who followed", asOther.youFollow === false, `youFollow=${asOther.youFollow}`);

  /* ------------------------------------------------------------ my_bootstrap */

  section("my_bootstrap() — one round trip for a session");
  await asUser(listenerA);
  const boot = (await sql("select public.my_bootstrap() as b")).rows[0].b ?? {};
  const BOOT_KEYS = ["user", "stats", "liked", "followed", "savedCollections", "playlists", "songs", "history"];
  const bootGaps = BOOT_KEYS.filter((k) => !(k in boot));
  check("it carries the profile, the counters and the library", bootGaps.length === 0,
    bootGaps.length ? `missing ${bootGaps.join(", ")}` : `${boot.user?.handle} · ${boot.playlists?.length ?? 0} sets · ${boot.history?.length ?? 0} in history`);
  check("the profile has an id, a handle and a role", Boolean(boot.user?.id && boot.user?.handle && boot.user?.role), JSON.stringify(boot.user ?? null).slice(0, 120));
  const STATS_KEYS = ["published", "notes", "loved", "playlists", "amens", "followers", "following", "plays", "listenSeconds", "days", "songs", "firstAt"];
  const statsGaps = STATS_KEYS.filter((k) => !(k in (boot.stats ?? {})));
  check("and the counters the sidebar prints", statsGaps.length === 0, statsGaps.length ? `missing ${statsGaps.join(", ")}` : "");

  const listening = (await sql("select public.my_listening() as l")).rows[0].l ?? {};
  check("my_listening() answers plays, seconds, days", ["plays", "listenSeconds", "days"].every((k) => k in listening), JSON.stringify(listening));
  /* -------------------------------------------------------- run it all again */

  section("Run the whole thing again — the bundle promises it is safe");
  await asPostgres();
  const songsBefore = Number(await one("select count(*) from public.songs"));
  const policiesBefore = Number(await one("select count(*) from pg_policies where schemaname = 'public'"));
  const triggersBefore = Number(await one("select count(*) from pg_trigger where not tgisinternal"));
  let rerunError = null;
  for (const name of MIGRATIONS) {
    try {
      await db.exec(readFileSync(join(ROOT, "supabase/migrations", name), "utf8"));
    } catch (err) {
      rerunError = rerunError ?? `${name}: ${String(err.message).split("\n")[0]}`;
    }
  }
  check("every migration applies a second time", rerunError === null, rerunError ?? "tables, indexes, triggers and policies are all drop-if-exists / if-not-exists");
  try {
    await db.exec(seed);
    check("and so does the seed", true);
  } catch (err) {
    check("and so does the seed", false, String(err.message).split("\n")[0]);
  }
  check("nothing about the schema changed", Number(await one("select count(*) from pg_policies where schemaname = 'public'")) === policiesBefore
    && Number(await one("select count(*) from pg_trigger where not tgisinternal")) === triggersBefore,
    `${policiesBefore} policies · ${triggersBefore} triggers`);
  check("and nothing about the catalogue did either", Number(await one("select count(*) from public.songs")) === songsBefore,
    `${songsBefore} nasheeds`);
  const replayed = (await sql("select public.catalog_payload() as payload")).rows[0]?.payload ?? {};
  check("and the room still reads", (replayed.songs ?? []).length === songsBefore - 1, `${replayed.songs?.length ?? 0} live`);

} catch (err) {
  exitCode = 1;
  aborted = String(err?.message ?? err).split("\n")[0];
  console.log(`\n${red("The run stopped:")} ${err?.message ?? err}`);
  if (err?.stack) console.log(dim(err.stack.split("\n").slice(1, 4).join("\n")));
}

section("Result");
await asPostgres().catch(() => {});
console.log(`  ${checks - failures.length}/${checks} checks passed${aborted ? red(` — the run stopped early: ${aborted}`) : ""}`);
if (failures.length) {
  console.log(`\n${red(`${failures.length} failed:`)}`);
  for (const failure of failures) console.log(`  ${red("✗")} ${failure}`);
  exitCode = 1;
} else if (!aborted) {
  console.log(`  ${green("the schema, the seed, the RPCs and RLS all behave")}`);
}
await db.close().catch(() => {});
process.exit(exitCode);
