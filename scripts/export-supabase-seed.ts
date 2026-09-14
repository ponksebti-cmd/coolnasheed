/**
 * Turn the bundled catalogue into `supabase/seed.sql`.
 *
 * Run with `npm run seed`. `supabase db reset` then applies it automatically, and on a
 * hosted project you can pipe it straight in:
 *
 *     psql "$SUPABASE_DB_URL" -f supabase/seed.sql
 *
 * Two things this file is careful about:
 *
 *   • Idempotency. Every insert is `on conflict do nothing`, so running the seed twice
 *     does not double a single counter — the triggers only fire on rows that land.
 *   • Honesty about the numbers. `plays` and `likes` are seeded as baselines that stand
 *     in for the audience a catalogue arrives with; everything under a nasheed that is
 *     actually a *row* (notes, amens, follows, daily stats) is real data the app can
 *     walk. The UI labels seeded content as generated, and so does this file.
 *
 * The seeded publishers and listeners have profiles but no auth users: they can be
 * followed, credited and quoted, and nobody can sign in as them.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { ARTISTS, COLLECTIONS, TRACKS, durationOf } from "../src/data/catalog";
import { notesFor } from "../src/lib/comments";
import { hashString, mulberry32 } from "../src/lib/prng";

const target = resolve(process.cwd(), "supabase/seed.sql");

/* ------------------------------------------------------------------ helpers */

/** Stable uuid v4 shape from a seed, so re-generating the file changes nothing. */
function uuidFor(seed: string): string {
  const bytes = Uint8Array.from(createHash("sha256").update(seed).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const artistUuid = (id: string) => uuidFor(`coolnasheed:artist:${id}`);
const listenerUuid = (handle: string) => uuidFor(`coolnasheed:listener:${handle}`);
const songId = (trackId: string) => `sng_${trackId}`;
const commentId = (noteId: string) => `cmt_${noteId}`;

/** SQL literal. Null in, NULL out. */
function q(value: string | null | undefined): string {
  if (value === null || value === undefined) return "null";
  return `'${value.replace(/'/g, "''")}'`;
}

function json(value: unknown): string {
  if (value === null || value === undefined) return "null";
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
}

function textArray(values: readonly string[]): string {
  return `array[${values.map(q).join(", ")}]::text[]`;
}

function intArray(values: readonly number[] | undefined): string {
  if (!values || values.length === 0) return "null";
  return `array[${values.join(", ")}]::integer[]`;
}

function bool(value: boolean | undefined): string {
  return value ? "true" : "false";
}

/** "now() minus n days, minus h hours" — relative so a re-seed always looks fresh. */
function daysAgo(days: number, hours = 0): string {
  const parts: string[] = [];
  if (days) parts.push(`${days} days`);
  if (hours) parts.push(`${hours} hours`);
  if (parts.length === 0) return "now()";
  return `now() - interval '${parts.join(" ")}'`;
}

const today = "(now() at time zone 'utc')::date";
const dayOffset = (back: number) => `${today} - ${back}`;

/* ------------------------------------------------------------------- people */

const artistRows = ARTISTS.map((a, i) => {
  const joined = 400 + i * 97;
  return `  ('${artistUuid(a.id)}', ${q(a.id)}, ${q(a.name)}, ${q(a.nameAr ?? null)}, ${q(a.role)},
   ${q(a.bio)}, ${q(a.origin)}, ${q(a.seed)}, ${q(a.accent)}, 'listener', 'artist', ${bool(a.verified)}, ${daysAgo(joined)})`;
});

/** The handles the seeded notes speak with, so those notes have an author to point at. */
const listenerHandles = [...new Set(TRACKS.flatMap((t) => notesFor(t, 6).map((n) => n.handle)))].sort();

const prettyHandle = (handle: string) =>
  handle
    .split(/[._]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const listenerRows = listenerHandles.map((handle, i) => {
  const joined = 30 + i * 13;
  return `  ('${listenerUuid(handle)}', ${q(handle)}, ${q(prettyHandle(handle))}, null, '',
   ${q("Seeded listener. Everything they say under a nasheed is generated, and the app says so.")},
   '', ${q(`listener-${handle}`)}, 'turq', 'listener', 'listener', false, ${daysAgo(joined)})`;
});

/* -------------------------------------------------------------------- songs */

const songRows = TRACKS.map((t, i) => {
  const rng = mulberry32(hashString(`seed-stats-${t.id}`));
  const plays = Math.round(1_200 + rng() * 40_000);
  const likes = Math.round(plays * (0.02 + rng() * 0.03));
  const published = 20 + i * 41 + Math.floor(rng() * 30);
  const durationMs = Math.round(durationOf(t) * 1000);
  const lines = t.lines.map((l) => ({
    ...(l.tr ? { tr: l.tr } : {}),
    ...(l.ar ? { ar: l.ar } : {}),
    ...(l.en ? { en: l.en } : {}),
    ...(l.note ? { note: l.note } : {}),
  }));

  return `  (${q(songId(t.id))}, '${artistUuid(t.artistId)}', ${q(t.title)}, ${q(t.titleAr ?? null)}, ${q(t.blurb)},
   ${q(t.maqam)}, ${t.root}, ${t.bpm}, ${q(t.voices)}, ${t.duff ? q(t.duff) : "null"}, ${q(t.duffEnter ?? "verse")},
   ${t.passes ?? 2}, ${q(t.accent)}, ${t.year}, ${textArray(t.tags)}, ${json(lines)}, ${intArray(t.motifBank)},
   null, null, null, ${durationMs}, null, 'live', ${daysAgo(published)}, ${plays}, ${likes}, 0)`;
});

/* ------------------------------------------------------------------ shelves */

const collectionRows = COLLECTIONS.map((c, i) => {
  const owner = TRACKS.find((t) => t.id === c.trackIds[0]);
  return `  (${q(c.id)}, ${q(c.kind)}, ${q(c.title)}, ${q(c.titleAr ?? null)}, ${q(c.curator)}, ${q(c.blurb)},
   ${q(c.seed)}, ${q(c.accent)}, ${textArray(c.tags)}, ${c.year},
   ${textArray(c.trackIds.map(songId))}, ${owner ? `'${artistUuid(owner.artistId)}'` : "null"}, ${daysAgo(30 + i * 22)})`;
});

/* ------------------------------------------------------------------ social */

const follows: string[] = [];
const loves: string[] = [];
const comments: string[] = [];
const amens: string[] = [];

for (const handle of listenerHandles) {
  const rng = mulberry32(hashString(`seed-follows-${handle}`));
  // everybody follows two or three of the publishers
  for (const artist of ARTISTS) {
    if (rng() < 0.34) {
      follows.push(
        `  ('${listenerUuid(handle)}', '${artistUuid(artist.id)}', ${daysAgo(Math.floor(rng() * 300) + 3)})`,
      );
    }
  }
  // and they have favourites
  for (const track of TRACKS) {
    if (rng() < 0.09) {
      loves.push(`  ('${listenerUuid(handle)}', ${q(songId(track.id))}, ${daysAgo(Math.floor(rng() * 200))})`);
    }
  }
}

for (const track of TRACKS) {
  for (const note of notesFor(track, 6)) {
    const rng = mulberry32(hashString(`seed-note-${note.id}`));
    const baseline = Math.round(note.likes * 0.12);
    comments.push(
      `  (${q(commentId(note.id))}, ${q(songId(track.id))}, '${listenerUuid(note.handle)}', ${q(note.text)},
   ${note.atLine ?? "null"}, ${baseline}, ${daysAgo(note.daysAgo, Math.floor(rng() * 20))})`,
    );
    // a couple of real amin rows on top of the baseline, so the counter has something behind it
    for (const handle of listenerHandles) {
      if (handle === note.handle) continue;
      if (mulberry32(hashString(`seed-amin-${note.id}-${handle}`))() < 0.07) {
        amens.push(`  ('${listenerUuid(handle)}', ${q(commentId(note.id))}, ${daysAgo(Math.max(0, note.daysAgo - 1))})`);
      }
    }
  }
}

/* ---------------------------------------------------------------- analytics */

/** Fourteen days of rollups, weighted towards the present, so the charts are not empty. */
const songDaily: string[] = [];
const siteDaily = new Map<number, { plays: number; listeners: number }>();

for (const track of TRACKS) {
  const rng = mulberry32(hashString(`seed-daily-${track.id}`));
  const total = Math.round(120 + rng() * 900);
  // fourteen days, heavier towards today, with quiet days in between
  const weights = Array.from({ length: 14 }, (_, i) => 0.4 + i * 0.16 + rng() * 0.6);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let assigned = 0;

  for (let i = 0; i < 14; i += 1) {
    const back = 13 - i;
    const last = i === 13;
    let plays = last ? total - assigned : Math.round((total * weights[i]!) / weightSum);
    assigned += plays;
    if (!last && rng() < 0.22) {
      // a quiet day: nothing played, no row
      assigned -= plays;
      plays = 0;
    }
    if (plays <= 0) continue;

    const listeners = Math.max(1, Math.round(plays * (0.45 + rng() * 0.3)));
    const seconds = plays * Math.round(durationOf(track) * (0.35 + rng() * 0.5));
    songDaily.push(`  (${q(songId(track.id))}, ${dayOffset(back)}, ${plays}, ${listeners}, ${seconds})`);

    const bucket = siteDaily.get(back) ?? { plays: 0, listeners: 0 };
    bucket.plays += plays;
    bucket.listeners += listeners;
    siteDaily.set(back, bucket);
  }
}

const siteRows = [...siteDaily.entries()]
  .sort((a, b) => b[0] - a[0])
  .map(([back, v]) => {
    const signups = mulberry32(hashString(`seed-signups-${back}`))() < 0.5 ? 1 : 0;
    return `  (${dayOffset(back)}, ${v.plays}, ${v.listeners}, ${signups})`;
  });

/* --------------------------------------------------------------------- file */

const values = (rows: string[]) => rows.join(",\n");

const sql = `-- CoolNasheed · seed
--
-- Generated by scripts/export-supabase-seed.ts — do not edit by hand, edit the
-- generator and run \`npm run seed\` again.
--
--   ${ARTISTS.length} publishers · ${listenerHandles.length} seeded listeners · ${TRACKS.length} nasheeds ·
--   ${COLLECTIONS.length} shelves · ${comments.length} notes · ${songDaily.length} days of nasheed stats
--
-- Every statement is \`on conflict do nothing\`, so seeding twice changes nothing.
-- \`plays\` and \`likes\` on a nasheed are baselines: the audience a catalogue arrives
-- with. Notes, amens, follows and the daily rollups are rows the app can walk.

begin;

-- publishers ---------------------------------------------------------------

insert into public.profiles
  (id, handle, name, name_ar, tagline, bio, city, seed, accent, role, kind, verified, created_at)
values
${values(artistRows)}
on conflict (id) do nothing;

insert into public.reserved_handles (handle) values
${values(ARTISTS.map((a) => `  (${q(a.id)})`))}
on conflict (handle) do nothing;

-- seeded listeners (the voices under the nasheeds) --------------------------

insert into public.profiles
  (id, handle, name, name_ar, tagline, bio, city, seed, accent, role, kind, verified, created_at)
values
${values(listenerRows)}
on conflict (id) do nothing;

-- nasheeds ------------------------------------------------------------------
-- no audio_path: these are compositions, so the browser engine sings them. That is
-- also why they cost nothing in storage.

insert into public.songs
  (id, owner_id, title, title_ar, note, maqam, root, bpm, voices, duff, duff_enter,
   passes, accent, year, tags, lines, motif_bank,
   audio_path, audio_mime, audio_bytes, duration_ms, artwork_path, status, published_at,
   plays, likes, notes)
values
${values(songRows)}
on conflict (id) do nothing;

-- shelves -------------------------------------------------------------------

insert into public.collections
  (id, kind, title, title_ar, curator, blurb, seed, accent, tags, year, song_ids, owner_id, created_at)
values
${values(collectionRows)}
on conflict (id) do nothing;

-- who follows whom ----------------------------------------------------------

insert into public.follows (profile_id, artist_id, created_at) values
${values(follows)}
on conflict (profile_id, artist_id) do nothing;

-- what they loved -----------------------------------------------------------

insert into public.loves (profile_id, song_id, created_at) values
${values(loves)}
on conflict (profile_id, song_id) do nothing;

-- the notes under each nasheed ----------------------------------------------
-- generated text from a fixed pool, attributed to seeded listeners; the interface says
-- so where it shows them.

insert into public.comments (id, song_id, author_id, text, at_line, amens, created_at) values
${values(comments)}
on conflict (id) do nothing;

insert into public.amens (profile_id, comment_id, created_at) values
${values(amens)}
on conflict (profile_id, comment_id) do nothing;

-- fourteen days of charts ---------------------------------------------------

insert into public.song_stats_daily (song_id, day, plays, listeners, seconds) values
${values(songDaily)}
on conflict (song_id, day) do nothing;

insert into public.site_stats_daily (day, plays, listeners, signups) values
${values(siteRows)}
on conflict (day) do nothing;

-- counters follow the rows that are actually there --------------------------
-- the triggers above have been keeping these as the inserts landed; this last pass
-- simply makes sure a re-seed leaves them exact.

update public.songs s
   set notes = (select count(*)::integer from public.comments c
                 where c.song_id = s.id and not c.removed);

commit;
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, sql, "utf8");

const kb = Math.round(Buffer.byteLength(sql, "utf8") / 1024);
console.log(
  `seed → ${target} (${kb} KB)\n` +
    `  ${ARTISTS.length} publishers · ${listenerHandles.length} listeners · ${TRACKS.length} nasheeds · ` +
    `${COLLECTIONS.length} shelves · ${comments.length} notes · ${follows.length} follows · ` +
    `${loves.length} loves · ${amens.length} amens · ${songDaily.length} song-days`,
);
