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
/** The same cases the two validators are held to — every row here is inserted below. */
const FIXTURE = join(ROOT, "shared/fixtures/publish-cases.json");

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

  /* the same fixture the two validators are held to — every one of its rows is
     inserted into the table further down, as a publisher, under RLS */
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));

  /* ------------------------------------------------------------- the schema */

  section("Shape of the schema");
  const EXPECTED_TABLES = [
    "amens", "collections", "comments", "dhikr_counts", "follows", "loves", "play_events",
    "playlists", "profiles", "reports", "reserved_handles", "saved_collections",
    "site_stats_daily", "song_stats_daily", "songs", "studio_drafts", "user_prefs",
  ];
  const tables = (await sql("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map((r) => r.tablename);
  const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
  check(`all ${EXPECTED_TABLES.length} tables exist`, missing.length === 0,
    missing.length ? `missing ${missing.join(", ")}` : `${tables.length} in public`);

  const noRls = (await sql(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1
  `)).rows.map((r) => r.relname);
  check("row level security is on for every table", noRls.length === 0, noRls.length ? `off: ${noRls.join(", ")}` : "");

  const policies = Number(await one("select count(*) from pg_policies where schemaname = 'public'"));
  check("the policies are all there", policies >= 45, `${policies} in public`);

  /* The database names its own version. The client reads this at boot and refuses to
     guess from a constraint name when a project is a build behind. */
  const version = await one("select version from public.app_schema where id = 1");
  check("the database says which version of the app it is", version === "profile-pictures-1", String(version));

  await asAnon();
  const anonVersion = await one("select version from public.app_schema where id = 1");
  check("and anyone may read it, signed in or not", anonVersion === "profile-pictures-1", String(anonVersion));
  await refused("but nobody may write it",
    () => sql("insert into public.app_schema (id, version) values (2, 'forged')"), "42501");
  await asPostgres();

  const buckets = (await sql("select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id")).rows;
  const audioBucket = buckets.find((b) => b.id === "nasheed-audio");
  const artBucket = buckets.find((b) => b.id === "nasheed-artwork");
  const avatarBucket = buckets.find((b) => b.id === "nasheed-avatars");
  check("the audio bucket takes mp3 and nothing else",
    buckets.length === 3 && Number(audioBucket?.file_size_limit) === 5242880
    && Array.isArray(audioBucket?.allowed_mime_types)
    && audioBucket.allowed_mime_types.every((mime) => mime.includes("mpeg") || mime.includes("mp3"))
    && !audioBucket.allowed_mime_types.some((mime) => /wav|ogg|aac|flac|webm/.test(mime)),
    `${audioBucket?.allowed_mime_types?.join(" ")} · ${audioBucket?.file_size_limit} bytes`);
  check("the artwork bucket takes four image types",
    Number(artBucket?.file_size_limit) === 2097152
    && artBucket?.allowed_mime_types?.length === 4
    && artBucket.allowed_mime_types.every((mime) => mime.startsWith("image/")),
    artBucket?.allowed_mime_types?.join(" "));

  /* ---- a face: one megabyte, images only, its own bucket ---- */
  check("a third bucket holds profile pictures, capped at 1 MB",
    Number(avatarBucket?.file_size_limit) === 1048576
    && avatarBucket?.allowed_mime_types?.length === 4
    && avatarBucket.allowed_mime_types.every((mime) => mime.startsWith("image/")),
    `${avatarBucket?.allowed_mime_types?.join(" ")} · ${avatarBucket?.file_size_limit} bytes`);


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
  check("every RPC the client calls exists", missingRpcs.length === 0,
    missingRpcs.length ? `missing ${missingRpcs.join(", ")}` : `${EXPECTED_RPCS.length} of them`);

  /* ------------------------------------------------- what is no longer there */

  section("What the audio-only migration took away");
  const columnsOf = async (table) =>
    (await sql("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [table]))
      .rows.map((r) => r.column_name);

  const songColumns = await columnsOf("songs");
  /* Ten columns that the product does not have. `accent` and `year` are here because they
     are the same kind of thing as `bpm`: a field on the row that no listener ever asked
     for and no publisher should be handed. */
  const synthesis = ["maqam", "root", "bpm", "voices", "duff", "duff_enter", "passes", "motif_bank", "accent", "year"]
    .filter((c) => songColumns.includes(c));
  const themeDefault = String(
    (await sql("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'user_prefs' and column_name = 'theme'")).rows[0]?.column_default ?? "",
  );
  check("a settings row nobody has written yet is light, not night",
    /'dawn'/.test(themeDefault), themeDefault);

  const profileColumns = await columnsOf("profiles");
  check("nothing on a song is a picture, and a profile may carry one",
    profileColumns.includes("avatar_path") && !songColumns.includes("avatar_path"));

  check("the songs table carries no composition, colour or year parameters", synthesis.length === 0,
    synthesis.length ? `still there: ${synthesis.join(", ")}` : `${songColumns.length} columns left, 10 checked`);
  check("and it does carry the recording", ["audio_path", "audio_mime", "audio_bytes", "duration_ms", "artwork_path"].every((c) => songColumns.includes(c)));

  const seedColumns = (await sql(`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and column_name = 'seed'`)).rows;
  check("no table has a pattern seed left", seedColumns.length === 0,
    seedColumns.map((r) => r.table_name).join(", "));

  const clientId = Number(await one(`
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'play_events' and column_name = 'client_id'`));
  check("the play beacon is no longer keyed by a browser id", clientId === 0);

  /* ------------------------------------------------------------ empty seed */

  section("What the seed put in — nothing, on purpose");
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
      (select count(*) from public.play_events)                     as events,
      (select count(*) from public.song_stats_daily)                as song_days,
      (select count(*) from public.site_stats_daily)                as site_days
  `)).rows[0];
  check("no invented catalogue, no invented listeners",
    Object.values(counts).every((value) => Number(value) === 0),
    Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(" "));
  await db.exec(seed);
  check("and seeding twice changes nothing", Number(await one("select count(*) from public.songs")) === 0);

  /* --------------------------------------------------------------- sign-up */

  section("Signing up (the auth trigger)");
  const owner = fixture.owner;
  await sql(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, 'publisher@nasheed.test', '{\"handle\":\"hafsa.noor\",\"name\":\"Hafsa Noor\"}'::jsonb)",
    [owner],
  );
  const publisher = (await sql("select id, handle, name, role, kind from public.profiles where id = $1", [owner])).rows[0];
  check("a profile appears with the handle that was asked for", publisher?.handle === "hafsa.noor", JSON.stringify(publisher ?? null));
  check("and a profile row is not a publisher until something is published", publisher?.kind === "listener", `kind=${publisher?.kind}`);
  check("the first account on a fresh project is staff", publisher?.role === "staff", `role=${publisher?.role}`);

  const prefs = (await sql("select * from public.user_prefs where profile_id = $1", [owner])).rows[0];
  check("their preferences exist without anyone inserting them",
    /* light, because the house is light: a row nobody wrote yet must not arrive as a
       theme the person never chose */
    prefs?.theme === "dawn" && Number(prefs?.volume) === 0.85 && prefs?.lyric_script === "tr" && prefs?.show_arabic === true,
    JSON.stringify(prefs ?? null).slice(0, 140));

  const secondId = await one(
    "insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'listener@nasheed.test', '{\"handle\":\"hafsa.noor\"}'::jsonb) returning id",
  );
  const second = (await sql("select handle, role, kind from public.profiles where id = $1", [secondId])).rows[0];
  check("a taken handle is resolved, not refused", second?.handle !== "hafsa.noor" && /^hafsa\.noor\d{4}$/.test(second?.handle ?? ""), `handle=${second?.handle}`);
  check("and the second account is a listener", second?.role === "listener" && second?.kind === "listener", `role=${second?.role} kind=${second?.kind}`);

  const thirdId = await one(
    "insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'third@nasheed.test', '{\"handle\":\"maryam.q\"}'::jsonb) returning id",
  );
  const fourthId = await one(
    "insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'fourth@nasheed.test', '{\"handle\":\"salim.b\"}'::jsonb) returning id",
  );

  const signups = Number(await one("select coalesce(sum(signups),0) from public.site_stats_daily where day = (now() at time zone 'utc')::date"));
  check("signups land in the daily rollup", signups === 4, `${signups} today`);

  /* ------------------------------------------------- a live nasheed needs audio */

  section("A live nasheed, and the recording it must have");
  await asUser(owner);
  await refused("a live row with no audio_path is refused",
    () => sql("insert into public.songs (owner_id, title) values ($1, 'Silent nasheed')", [owner]), "23514");
  await refused("a duration under a second is refused",
    () => sql(`insert into public.songs (owner_id, title, audio_path, duration_ms)
               values ($1, 'Too short', $2, 500)`, [owner, `${owner}/short.mp3`]), "23514");

  /* the eleven columns a publisher may write, and nothing else: no colour, no year */
  const own = await sql(
    `insert into public.songs
       (owner_id, title, title_ar, note, tags, lines, audio_path, audio_mime, audio_bytes, duration_ms)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, 'audio/mpeg', 5120000, 192000)
     returning id, plays, likes, notes, status`,
    [owner, "Ṭalaʿa al-Badru ʿAlaynā", "طلع البدر علينا", "The oldest welcome song we have.",
     ["traditional", "madinah"], JSON.stringify([{ tr: "ṭalaʿa al-badru ʿalaynā", en: "the full moon rose over us", t: 0 }]),
     `${owner}/talaa.mp3`],
  );
  const ownRow = own.rows[0];
  check("a publisher may publish their own nasheed, recording and all", Boolean(ownRow?.id), String(ownRow?.id));
  check("and it starts at zero, with the database owning the counters",
    ownRow?.plays === 0 && ownRow?.likes === 0 && ownRow?.notes === 0 && ownRow?.status === "live",
    JSON.stringify(ownRow ?? null).slice(0, 120));
  check("publishing it turned the account into a publisher",
    (await sql("select kind from public.profiles where id = $1", [owner])).rows[0].kind === "artist");

  await refused("but cannot buy itself a play count",
    () => sql("update public.songs set plays = 999999 where id = $1", [ownRow.id]), "42501");
  await refused("nor hand the row to somebody else",
    () => sql("update public.songs set owner_id = $1 where id = $2", [secondId, ownRow.id]), "42501");

  /* ------------------------------------------------------------ play beacon */

  section("record_play() — the analytics engine, without a device id");
  const songId = ownRow.id;
  const playsBefore = Number(await one("select plays from public.songs where id = $1", [songId]));
  const TODAY = "(now() at time zone 'utc')::date";
  const rollupBefore = (await sql(`
    select coalesce(plays,0) as plays, coalesce(listeners,0) as listeners, coalesce(seconds,0) as seconds
      from public.song_stats_daily where song_id = $1 and day = ${TODAY}`, [songId])).rows[0] ?? { plays: 0, listeners: 0, seconds: 0 };
  const siteBefore = (await sql(`
    select coalesce(plays,0) as plays, coalesce(listeners,0) as listeners
      from public.site_stats_daily where day = ${TODAY}`)).rows[0] ?? { plays: 0, listeners: 0 };

  await asAnon();
  const p1 = (await sql("select public.record_play($1, 40, false) as r", [songId])).rows[0].r;
  check("a signed-out listen counts, with nobody to attribute it to", p1.ok === true && p1.counted === true, JSON.stringify(p1));
  check("and songs.plays actually moves", Number(await one("select plays from public.songs where id = $1", [songId])) === playsBefore + 1);

  const p2 = (await sql("select public.record_play($1, 40, false) as r", [songId])).rows[0].r;
  check("the same beacon five seconds later is a duplicate", p2.duplicate === true && p2.counted === false, JSON.stringify(p2));
  check("and it did not count twice", Number(await one("select plays from public.songs where id = $1", [songId])) === playsBefore + 1);

  await asUser(secondId);
  const p3 = (await sql("select public.record_play($1, 40, false) as r", [songId])).rows[0].r;
  check("a signed-in listener counts as themselves", p3.counted === true, JSON.stringify(p3));
  const p4 = (await sql("select public.record_play($1, 40, false) as r", [songId])).rows[0].r;
  check("and is deduped by account, not by device", p4.duplicate === true, JSON.stringify(p4));

  await asUser(thirdId);
  const p5 = (await sql("select public.record_play($1, 4, false) as r", [songId])).rows[0].r;
  check("four seconds is not a listen", p5.ok === true && p5.counted === false, JSON.stringify(p5));
  await asPostgres();
  check("but it still leaves its event and its seconds",
    Number(await one("select count(*) from public.play_events where song_id = $1 and profile_id = $2", [songId, thirdId])) === 1
    && Number(await one("select seconds from public.play_events where song_id = $1 and profile_id = $2", [songId, thirdId])) === 4);

  await asUser(fourthId);
  const p6 = (await sql("select public.record_play($1, 2, true) as r", [songId])).rows[0].r;
  check("finishing a nasheed counts, however short", p6.counted === true, JSON.stringify(p6));

  await asAnon();
  const gone = (await sql("select public.record_play('sng_not-here', 60, true) as r")).rows[0].r;
  check("a beacon for a nasheed that is not there says so", gone.ok === false && typeof gone.error === "string", JSON.stringify(gone));

  await asPostgres();
  const rollup = (await sql(`
    select plays, listeners, seconds from public.song_stats_daily
     where song_id = $1 and day = ${TODAY}`, [songId])).rows[0] ?? { plays: 0, listeners: 0, seconds: 0 };
  const dPlays = Number(rollup.plays) - Number(rollupBefore.plays);
  const dListeners = Number(rollup.listeners) - Number(rollupBefore.listeners);
  const dSeconds = Number(rollup.seconds) - Number(rollupBefore.seconds);
  check("the day's rollup counted three real listens", dPlays === 3, `+${dPlays} plays (now ${rollup.plays})`);
  check("four people pressed play — the skip counts as a listener, not as a play", dListeners === 4, `+${dListeners} listeners`);
  check("and the seconds are what was actually spent: 40+40+4+2", dSeconds === 86, `+${dSeconds}s (now ${rollup.seconds})`);
  check("a four-second skip left the play count alone",
    Number(await one("select plays from public.songs where id = $1", [songId])) === playsBefore + 3,
    `${playsBefore} → ${await one("select plays from public.songs where id = $1", [songId])}`);

  const site = (await sql(`select plays, listeners from public.site_stats_daily where day = ${TODAY}`)).rows[0] ?? { plays: 0, listeners: 0 };
  check("and so did the site's rollup",
    Number(site.plays) - Number(siteBefore.plays) === 3 && Number(site.listeners) - Number(siteBefore.listeners) === 4,
    `+${Number(site.plays) - Number(siteBefore.plays)} plays · +${Number(site.listeners) - Number(siteBefore.listeners)} listeners`);

  /* ------------------------------------------------------- the catalogue RPC */

  section("catalog_payload() — what the client hydrates from");
  await asAnon();
  const payload = (await sql("select public.catalog_payload() as payload")).rows[0]?.payload ?? {};
  const songs = payload.songs ?? [];
  const artists = payload.artists ?? [];
  const collections = payload.collections ?? [];
  const tags = payload.tags ?? [];
  check("one published nasheed, one publisher, two tags",
    songs.length === 1 && artists.length === 1 && collections.length === 0 && tags.length === 2,
    `${songs.length} songs · ${artists.length} artists · ${collections.length} sets · ${tags.length} tags`);

  const SONG_KEYS = ["id", "ownerId", "ownerHandle", "ownerName", "title", "titleAr", "note",
    "tags", "lines", "audioPath", "audioMime", "audioBytes", "durationMs", "artworkPath",
    "status", "publishedAt", "plays", "likes", "notes"];
  const songKeyGaps = SONG_KEYS.filter((k) => !(k in (songs[0] ?? {})));
  check("a nasheed arrives in camelCase with every key the app reads", songKeyGaps.length === 0,
    songKeyGaps.length ? `missing ${songKeyGaps.join(", ")}` : `${SONG_KEYS.length} keys`);
  const compositionKeys = ["maqam", "root", "bpm", "voices", "duff", "motifBank", "seed"].filter((k) => k in (songs[0] ?? {}));
  check("and with none of the composition keys the app used to read", compositionKeys.length === 0,
    compositionKeys.join(", "));

  const ARTIST_KEYS = ["id", "profileId", "handle", "name", "nameAr", "role", "origin", "bio", "accent", "verified", "kind", "songs", "followers"];
  const artistKeyGaps = ARTIST_KEYS.filter((k) => !(k in (artists[0] ?? {})));
  check("a publisher arrives with the keys the card reads", artistKeyGaps.length === 0,
    artistKeyGaps.length ? `missing ${artistKeyGaps.join(", ")}` : `${ARTIST_KEYS.length} keys`);

  check("tags arrive as {tag, count}", tags.every((t) => typeof t.tag === "string" && typeof Number(t.count) === "number"),
    tags.map((t) => `${t.tag}:${t.count}`).join(" "));
  check("the nasheed is credited to the publisher's handle, not their uuid",
    songs[0]?.ownerHandle === "hafsa.noor" && songs[0]?.ownerId === owner, `ownerHandle=${songs[0]?.ownerHandle}`);
  check("its lyrics arrive as lines, with the timing the publisher gave them",
    Array.isArray(songs[0]?.lines) && songs[0].lines[0]?.tr === "ṭalaʿa al-badru ʿalaynā" && songs[0].lines[0]?.t === 0,
    JSON.stringify(songs[0]?.lines ?? null));
  check("it carries the storage path, not a url", typeof songs[0]?.audioPath === "string" && !songs[0].audioPath.startsWith("http"));

  /* --------------------------------------------------------- the read paths */

  section("The read paths the pages use");
  await asAnon();
  const TRENDING_KEYS = ["song_id", "title", "artwork_path", "owner_name", "plays", "listeners", "seconds", "likes"];
  const trending = (await sql("select * from public.trending('7d', 10)")).rows ?? [];
  const trendingGaps = TRENDING_KEYS.filter((k) => !(k in (trending[0] ?? {})));
  check("trending() answers in the columns trendingFromRow reads",
    trending.length === 1 && trendingGaps.length === 0,
    trendingGaps.length ? `missing ${trendingGaps.join(", ")}` : `${trending.length} row, ${trending[0]?.plays} plays`);
  check("and it counts listens, not skips", Number(trending[0]?.plays) === 3, `plays=${trending[0]?.plays}`);

  const DAILY_KEYS = ["day", "plays", "listeners", "signups"];
  const daily = (await sql("select * from public.daily_curve(14)")).rows ?? [];
  const dailyGaps = DAILY_KEYS.filter((k) => !(k in (daily[0] ?? {})));
  check("daily_curve() answers one row per day, zero-filled", daily.length === 14 && dailyGaps.length === 0,
    dailyGaps.length ? `missing ${dailyGaps.join(", ")}` : `${daily.length} days`);

  const stats = (await sql("select public.song_stats($1) as s", [songId])).rows[0].s ?? {};
  check("song_stats() answers plays, listeners, seconds, completed and a curve",
    ["plays", "listeners", "seconds", "completed", "daily"].every((k) => k in stats) && Array.isArray(stats.daily),
    `${stats.plays} plays · ${stats.listeners} listeners · ${stats.daily?.length ?? 0} days`);

  const anonHistory = (await sql("select public.my_history(30) as rows")).rows[0]?.rows ?? null;
  check("my_history() has nothing to say to a signed-out visitor", !anonHistory || anonHistory.length === 0,
    JSON.stringify(anonHistory ?? null).slice(0, 80));

  await asUser(secondId);
  const history = (await sql("select public.my_history(30) as rows")).rows[0]?.rows ?? [];
  const HISTORY_KEYS = ["songId", "title", "artworkPath", "ownerName", "plays", "seconds", "lastAt"];
  const historyGaps = HISTORY_KEYS.filter((k) => !(k in (history[0] ?? {})));
  check("but answers a signed-in listener in camelCase", history.length === 1 && historyGaps.length === 0,
    historyGaps.length ? `missing ${historyGaps.join(", ")}` : `${history.length} row`);

  await asAnon();
  const publisherPage = (await sql("select public.publisher_profile('hafsa.noor') as p")).rows[0].p ?? {};
  check("publisher_profile() takes a handle",
    publisherPage?.user?.handle === "hafsa.noor" && Array.isArray(publisherPage.songs)
    && typeof publisherPage.totals?.plays === "number" && typeof publisherPage.followers === "number",
    `${publisherPage?.user?.name} · ${publisherPage?.songs?.length ?? 0} nasheeds · ${publisherPage?.totals?.plays ?? 0} plays`);

  const publisherByUuid = (await sql("select public.publisher_profile($1) as p", [owner])).rows[0].p ?? {};
  check("and it takes a uuid", publisherByUuid?.user?.handle === "hafsa.noor", `${publisherByUuid?.user?.handle ?? "nothing"}`);

  /* ------------------------------------------------------------ my_bootstrap */

  section("my_bootstrap() — one round trip for a session");
  await asUser(secondId);
  await sql("update public.user_prefs set theme = 'dawn', volume = 0.4 where profile_id = $1", [secondId]);
  await sql("insert into public.dhikr_counts (profile_id, phrase, count, target) values ($1, 'subhanallah', 33, 33)", [secondId]);
  await sql("insert into public.studio_drafts (profile_id, draft) values ($1, $2::jsonb)", [secondId, JSON.stringify({ title: "A draft nobody published", tags: ["dhikr"] })]);

  const boot = (await sql("select public.my_bootstrap() as b")).rows[0].b ?? {};
  const BOOT_KEYS = ["user", "prefs", "dhikr", "draft", "stats", "liked", "followed", "savedCollections", "playlists", "songs", "history"];
  const bootGaps = BOOT_KEYS.filter((k) => !(k in boot));
  check("it carries the profile, the preferences, the library and the draft", bootGaps.length === 0,
    bootGaps.length ? `missing ${bootGaps.join(", ")}` : `${boot.user?.handle} · ${boot.playlists?.length ?? 0} sets · ${boot.history?.length ?? 0} in history`);
  check("the profile has an id, a handle and a role", Boolean(boot.user?.id && boot.user?.handle && boot.user?.role),
    JSON.stringify(boot.user ?? null).slice(0, 120));
  check("a preference is a row, not a browser's memory",
    boot.prefs?.theme === "dawn" && Number(boot.prefs?.volume) === 0.4 && boot.prefs?.muted === false,
    JSON.stringify(boot.prefs ?? null));
  check("the dhikr count comes back", boot.dhikr?.length === 1 && boot.dhikr[0].phrase === "subhanallah" && boot.dhikr[0].count === 33,
    JSON.stringify(boot.dhikr ?? null));
  check("and so does an unpublished draft", boot.draft?.title === "A draft nobody published", JSON.stringify(boot.draft ?? null));

  const STATS_KEYS = ["published", "notes", "loved", "playlists", "amens", "followers", "following", "plays", "listenSeconds", "days"];
  const statsGaps = STATS_KEYS.filter((k) => !(k in (boot.stats ?? {})));
  check("and the counters the sidebar prints", statsGaps.length === 0,
    statsGaps.length ? `missing ${statsGaps.join(", ")}` : `plays=${boot.stats?.plays ?? 0} listenSeconds=${boot.stats?.listenSeconds ?? 0}`);

  const listening = (await sql("select public.my_listening() as l")).rows[0].l ?? {};
  check("my_listening() answers plays, seconds, days",
    ["plays", "listenSeconds", "days"].every((k) => k in listening), JSON.stringify(listening));

  /* ------------------------------------------------------------------- RLS */

  section("Row level security, as the three kinds of caller");
  await asAnon();
  check("an anonymous listener reads the catalogue", Number(await one("select count(*) from public.songs")) === 1);
  // anon has no table-level grant on these at all, which is a stronger refusal than
  // a policy that returns nothing — and the client never reads them directly anyway,
  // it goes through my_history() and my_bootstrap(), which are definer
  await refused("but not who played what", () => sql("select count(*) from public.play_events"), "42501");
  await refused("nor whose sets they are", () => sql("select count(*) from public.playlists"), "42501");
  await refused("nor anybody's preferences", () => sql("select count(*) from public.user_prefs"), "42501");
  await refused("and cannot love a nasheed",
    () => sql("insert into public.loves (profile_id, song_id) values ($1, $2)", [secondId, songId]), "42501");

  await asUser(secondId);
  const loved = await sql("insert into public.loves (profile_id, song_id) values ($1, $2) returning song_id", [secondId, songId]);
  check("a listener may love a nasheed", loved.affectedRows === 1);
  check("and the counter trigger moves it", Number(await one("select likes from public.songs where id = $1", [songId])) === 1);
  await refused("but cannot write the counter itself",
    () => sql("update public.songs set likes = 5000 where id = $1", [songId]), "42501");
  const unloved = await sql("delete from public.loves where profile_id = $1 and song_id = $2", [secondId, songId]);
  check("un-loving is allowed, and the counter follows it back down",
    unloved.affectedRows === 1 && Number(await one("select likes from public.songs where id = $1", [songId])) === 0);

  const note = await sql(
    "insert into public.comments (song_id, author_id, text) values ($1, $2, 'Peace on this one.') returning id",
    [songId, secondId],
  );
  const noteId = note.rows[0]?.id;
  check("a listener may leave a note, and songs.notes counts it",
    Boolean(noteId) && Number(await one("select notes from public.songs where id = $1", [songId])) === 1, String(noteId));

  await asUser(thirdId);
  const amen = await sql("insert into public.amens (profile_id, comment_id) values ($1, $2) returning comment_id", [thirdId, noteId]);
  check("somebody else may say āmīn, and the note's counter moves",
    amen.affectedRows === 1 && Number(await one("select amens from public.comments where id = $1", [noteId])) === 1);

  await refused("another listener cannot edit that note",
    () => sql("update public.comments set text = 'rewritten' where id = $1", [noteId]), null);
  await refused("nor delete it", () => sql("delete from public.comments where id = $1", [noteId]), null);
  await refused("nor hide it", () => sql("update public.comments set removed = true where id = $1", [noteId]), null);
  check("hiding was refused, not silently undone",
    (await sql("select removed from public.comments where id = $1", [noteId])).rows[0].removed === false);

  await asUser(secondId);
  const edited = await sql("update public.comments set text = 'Peace on this one, still.' where id = $1 returning edited_at", [noteId]);
  check("the author may edit their own note, and the edit is stamped", edited.affectedRows === 1 && Boolean(edited.rows[0]?.edited_at));
  // the profile guard reverts a privilege write rather than refusing it, so the
  // statement "succeeds" and changes nothing — which is what the next line checks
  await sql("update public.profiles set role = 'staff' where id = $1", [secondId]);
  check("but cannot promote themselves — the guard puts the role back",
    (await sql("select role from public.profiles where id = $1", [secondId])).rows[0].role === "listener");

  const set = await sql("insert into public.playlists (owner_id, name, song_ids) values ($1, 'Late night', $2) returning id", [secondId, [songId]]);
  const setId = set.rows[0]?.id;
  check("a listener may build a set", Boolean(setId));
  await asUser(thirdId);
  check("and it stays theirs", Number(await one("select count(*) from public.playlists where id = $1", [setId])) === 0);

  section("Preferences, dhikr and drafts are one account's own rows");
  await asUser(thirdId);
  check("somebody else's preferences are invisible", Number(await one("select count(*) from public.user_prefs where profile_id = $1", [secondId])) === 0);
  check("as are their dhikr counts", Number(await one("select count(*) from public.dhikr_counts where profile_id = $1", [secondId])) === 0);
  check("and their unpublished draft", Number(await one("select count(*) from public.studio_drafts where profile_id = $1", [secondId])) === 0);
  await refused("and writing into their row is refused",
    () => sql("insert into public.dhikr_counts (profile_id, phrase) values ($1, 'alhamdulillah')", [secondId]), "42501");
  await refused("as is writing a draft in somebody else's name",
    () => sql("insert into public.studio_drafts (profile_id, draft) values ($1, '{}'::jsonb)", [secondId]), "42501");

  /* ------------------------------------------------------- three reports hide */

  section("Three reports take a note off the page");
  await asPostgres();
  const targetNote = String(await one("select id from public.comments where not removed order by created_at limit 1"));
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

  await asPostgres();
  const openReportId = String((await sql("select id from public.reports where comment_id = $1 limit 1", [targetNote])).rows[0].id);

  await asUser(secondId);
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

  await asUser(owner);
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
  await asUser(secondId);
  const uploaded = await sql(
    "insert into storage.objects (bucket_id, name, owner) values ('nasheed-audio', $1, $2) returning name",
    [`${secondId}/nasheed-test.mp3`, secondId],
  );
  check("a publisher uploads into their own folder", uploaded.affectedRows === 1, uploaded.rows[0]?.name ?? "");
  await refused("but not into somebody else's", () => sql(
    "insert into storage.objects (bucket_id, name, owner) values ('nasheed-audio', $1, $2)",
    [`${thirdId}/stolen.mp3`, secondId],
  ), "42501");
  await asAnon();
  check("an anonymous listener can read the file back",
    Number(await one("select count(*) from storage.objects where bucket_id = 'nasheed-audio'")) === 1);
  await asUser(thirdId);
  await refused("and cannot delete somebody else's recording",
    () => sql("delete from storage.objects where name = $1", [`${secondId}/nasheed-test.mp3`]), null);

  /* ------------------------------------------------------------- the bypass */

  section("The guard bypass is not a client's to call");
  await asAnon();
  await refused("anon cannot set the marker", () => sql("select public.guard_bypass('because I said so')"), "42501");
  await asUser(secondId);
  await refused("and neither can a listener", () => sql("select public.guard_bypass('because I said so')"), "42501");
  await asPostgres();
  await db.exec("begin");
  await sql("select public.guard_bypass('three reports')");
  const bypassed = (await sql("select public.guard_bypassed() as b")).rows[0].b;
  await db.exec("commit");
  check("while the definer trigger that owns it still can", bypassed === true, `guard_bypassed() = ${bypassed} inside the same transaction`);

  /* ------------------------------------------- the publish contract, in the table */

  section("The publish contract, against the real table");
  const contractRows = fixture.cases.filter((c) => c.row);
  const refusedRows = [];
  const insertedIds = [];
  await asUser(owner);
  for (const c of contractRows) {
    const r = c.row;
    try {
      // as the publisher, not as the owner of the database: this is also the proof that
      // the column grants cover exactly what an upload needs and nothing more
      await sql(`
        insert into public.songs
          (owner_id, title, title_ar, note, tags, lines,
           audio_path, audio_mime, audio_bytes, duration_ms, artwork_path)
        values ($1,$2,$3,$4,$5::text[],$6::jsonb,$7,$8,$9,$10,$11)
        returning id`,
        [owner, r.title, r.title_ar, r.note, r.tags ?? [], JSON.stringify(r.lines ?? []),
         r.audio_path, r.audio_mime, r.audio_bytes, r.duration_ms, r.artwork_path]);
      insertedIds.push((await sql("select id from public.songs where owner_id = $1 and title = $2 and audio_path = $3 order by created_at desc limit 1", [owner, r.title, r.audio_path])).rows[0].id);
    } catch (err) {
      refusedRows.push(`${c.name}: ${String(err.message).split("\n")[0]}`);
    }
  }
  check(`all ${contractRows.length} rows the validators produce are rows Postgres accepts`,
    refusedRows.length === 0,
    refusedRows.length ? refusedRows.join(" · ") : "inserted under the column grants, as a publisher");

  await asPostgres();
  const contractCount = Number(await one(
    "select count(*) from public.songs where id = any($1::text[])", [insertedIds]));
  check("and they are all really in there", contractCount === contractRows.length,
    `${contractCount} of ${contractRows.length} rows owned by the publisher`);

  const contractWithoutAudio = Number(await one(
    "select count(*) from public.songs where id = any($1::text[]) and audio_path is null", [insertedIds]));
  check("every one of them has a recording attached", contractWithoutAudio === 0);

  /* -------------------------------------------------------------- following */

  section("Following a publisher");
  await asUser(secondId);
  const followed = await sql("insert into public.follows (profile_id, artist_id) values ($1, $2) returning artist_id", [secondId, owner]);
  check("a listener may follow a publisher", followed.affectedRows === 1);
  const asPublisher = (await sql("select public.publisher_profile($1) as p", [owner])).rows[0].p ?? {};
  check("and the publisher's page says so", asPublisher.youFollow === true,
    `youFollow=${asPublisher.youFollow} followers=${asPublisher.followers}`);
  await asUser(thirdId);
  const asOther = (await sql("select public.publisher_profile($1) as p", [owner])).rows[0].p ?? {};
  check("but only for the person who followed", asOther.youFollow === false, `youFollow=${asOther.youFollow}`);

  /* --------------------------------------------------------------- takedown */

  section("Taking a nasheed down");
  await asUser(owner);
  const taken = await sql("update public.songs set status = 'removed' where id = $1 returning status", [ownRow.id]);
  check("its owner may take it down", taken.rows[0]?.status === "removed");
  await asAnon();
  const afterRemoval = (await sql("select public.catalog_payload() as payload")).rows[0]?.payload ?? {};
  check("after which the room cannot see it", !(afterRemoval.songs ?? []).some((x) => x.id === ownRow.id),
    `${afterRemoval.songs?.length ?? 0} live`);
  await asUser(secondId);
  await refused("and nobody else may take it down or put it back",
    () => sql("update public.songs set status = 'live' where id = $1", [ownRow.id]), null);

  /* ------------------------------------------------- the file people paste */

  /* Everything above ran the migrations as files, which is how `supabase db push` does it.
     What a person does is paste `supabase/setup.sql` into the SQL editor — onto a project
     that may already be half-built, and possibly twice. These two scenarios are the whole
     promise of that file. */

  section("What a person pastes, onto a project that already has migrations 1–4");
  /* The exact state a project set up by an older build is in: the four original migrations
     applied, no app_schema, `songs.maqam` still NOT NULL. This is not a hypothetical — it
     is the state that produced "publishing fails on a column the client never sends". */
  const behind = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await behind.exec(SHIM);
  /* The state a project set up by the pre-audio build is in: everything up to, but not
     including, the migrations that introduce the version marker. Derived from the files
     themselves — a migration that never mentions `app_schema` is one an old project has —
     so this stays true when more migrations are added. */
  const earlier = MIGRATIONS.filter(
    (name) => !readFileSync(join(ROOT, "supabase/migrations", name), "utf8").includes("app_schema"),
  );
  let behindProblem = "";
  for (const name of earlier) {
    try {
      await behind.exec(readFileSync(join(ROOT, "supabase/migrations", name), "utf8"));
    } catch (err) {
      behindProblem = `${name}: ${String(err.message).split("\n")[0]}`;
    }
  }
  check(`a project can sit at ${earlier.length} migrations while the build expects ${MIGRATIONS.length}`,
    behindProblem === "" && (await behind.query("select count(*)::int as n from information_schema.columns where table_name = 'songs' and column_name = 'maqam'")).rows[0].n === 1,
    behindProblem || "maqam is still a column, as it would be");

  const bundle = readFileSync(join(ROOT, "supabase/setup.sql"), "utf8");
  let pasteProblem = "";
  try {
    await behind.exec(bundle);
  } catch (err) {
    pasteProblem = String(err.message).split("\n").slice(0, 2).join(" · ");
  }
  check("and the setup file upgrades it in one paste", pasteProblem === "", pasteProblem || "no errors");

  const upgraded = await behind.query(
    "select (select count(*)::int from information_schema.columns where table_name = 'songs' and column_name = 'maqam') as maqam, " +
    "(select version from public.app_schema where id = 1) as version, " +
    "(select count(*)::int from public.applied_migrations) as applied",
  );
  const state = upgraded.rows[0] ?? {};
  check("the old column is gone and the version marker is there",
    state.maqam === 0 && state.version === "profile-pictures-1",
    `maqam columns=${state.maqam} · version=${state.version}`);
  check("and the file knows what it applied, so it need not do it twice",
    state.applied === MIGRATIONS.length,
    `${state.applied} of ${MIGRATIONS.length} recorded`);

  section("Pasting the same file a second time");
  let secondProblem = "";
  try {
    await behind.exec(bundle);
  } catch (err) {
    secondProblem = String(err.message).split("\n").slice(0, 2).join(" · ");
  }
  check("a second paste is a no-op rather than an error", secondProblem === "",
    secondProblem || "skipped every migration it had already applied");

  const afterSecond = await behind.query(
    "select (select version from public.app_schema where id = 1) as version, " +
    "(select count(*)::int from public.applied_migrations) as applied, " +
    "(select count(*)::int from pg_tables where schemaname = 'public') as tables",
  );
  const now_ = afterSecond.rows[0] ?? {};
  check("and it changed nothing", now_.version === "profile-pictures-1" && now_.applied === MIGRATIONS.length,
    `version=${now_.version} · ${now_.applied} recorded · ${now_.tables} tables`);

  section("What a person pastes, onto a project that has never been set up");
  const empty = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await empty.exec(SHIM);
  let freshProblem = "";
  try {
    await empty.exec(bundle);
  } catch (err) {
    freshProblem = String(err.message).split("\n").slice(0, 2).join(" · ");
  }
  check("a fresh project is built by one paste", freshProblem === "", freshProblem || "no errors");
  const freshState = (await empty.query(
    "select (select version from public.app_schema where id = 1) as version, " +
    "(select count(*)::int from pg_tables where schemaname = 'public') as tables",
  )).rows[0] ?? {};
  check("with the version marker and every table",
    freshState.version === "profile-pictures-1" && freshState.tables >= 18,
    `version=${freshState.version} · ${freshState.tables} tables`);
  await empty.close();
  await behind.close();

  section("Pasting the same file onto a project that was built by the CLI");
  /* The other half of the same problem: a project where `supabase db push` (or
     `npm run setup`) applied all five migrations the raw way. It has no
     `applied_migrations` table, so the file cannot ask what is done — it has to look at
     the database and see. Pasting here must do nothing at all, because migration 2's
     `trending()` selects a column migration 5 drops. */
  const pushed = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await pushed.exec(SHIM);
  let pushedProblem = "";
  for (const name of MIGRATIONS) {
    try {
      await pushed.exec(readFileSync(join(ROOT, "supabase/migrations", name), "utf8"));
    } catch (err) {
      pushedProblem = `${name}: ${String(err.message).split("\n")[0]}`;
    }
  }
  check("a project can be built by the migrations alone, with no ledger",
    pushedProblem === "", pushedProblem || `${MIGRATIONS.length} applied in order`);

  /* Everything the paste touches, counted without the ledger it creates — the ledger is
     the one thing a paste is allowed to add to a finished project. */
  const shape = (db) =>
    db.query(
      "select (select count(*)::int from pg_tables where schemaname = 'public' and tablename <> 'applied_migrations') as tables, " +
        "(select count(*)::int from pg_policies where schemaname = 'public') as policies, " +
        "(select count(*)::int from information_schema.columns where table_schema = 'public' and table_name <> 'applied_migrations') as columns",
    );
  const beforePaste = (await shape(pushed)).rows[0] ?? {};

  let pushedPaste = "";
  try {
    await pushed.exec(bundle);
  } catch (err) {
    pushedPaste = String(err.message).split("\n").slice(0, 2).join(" · ");
  }
  check("pasting the setup file over it changes nothing and errors on nothing",
    pushedPaste === "", pushedPaste || "every migration recognised as already applied");

  const afterPaste = {
    ...((await shape(pushed)).rows[0] ?? {}),
    applied: Number(await (async () =>
      (await pushed.query("select count(*)::int as n from public.applied_migrations")).rows[0].n)()),
  };
  check("and the file worked out what was already done by looking at the database",
    afterPaste.applied === MIGRATIONS.length,
    `${afterPaste.applied} of ${MIGRATIONS.length} recognised`);
  check("with every table, column and policy it found left exactly as it was",
    afterPaste.tables === beforePaste.tables &&
    afterPaste.columns === beforePaste.columns &&
    afterPaste.policies === beforePaste.policies,
    `${beforePaste.tables} tables → ${afterPaste.tables} · ${beforePaste.columns} columns → ${afterPaste.columns} · ${beforePaste.policies} policies → ${afterPaste.policies}`);
  await pushed.close();


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
