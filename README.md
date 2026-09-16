# CoolNasheed

A streaming home for nasheeds. A nasheed here is what it is in life: **an mp3 file somebody
recorded**, with a title, the words, and cover art if the publisher has any.

There is no composition model, no synthesis and no bundled catalogue. The app does not make
audio; it stores, plays and counts audio people upload. A fresh project opens on an empty
catalogue, which is what a fresh catalogue looks like, and fills as things are published.

The backend is **Supabase on the free tier** — Postgres with Row Level Security, Supabase
Auth, Storage for recordings and cover art, and six Edge Functions for the handful of jobs
that genuinely need a server. The client talks to the database directly for almost
everything, which is the only way a free tier survives real traffic.

```
npm install
cp .env.example .env      # your project URL + publishable key
npm run setup             # build the database (see "Setting it up")
npm run dev               # http://localhost:5173
npm run smoke             # headless suite — no browser, no project needed
npm run sql:test          # the migrations and RLS, against real Postgres (PGlite)
npm run verify            # typecheck + contract + database + bundles + build + smoke
```

---

## What's in it

| | |
|---|---|
| **Catalogue** | recordings people published. Empty until somebody uploads one — no seed, no generated rows |
| **Accounts** | Supabase Auth (email + password). Listening, searching and reading never need one; loving, noting, following, publishing and moderating do |
| **Lyrics** | per-word karaoke fill, three scripts (transliteration / العربية / English), a line rail, translations, and source notes for Qurʾān and public-domain lines |
| **Studio** | five steps: the recording, the words, the details, the cover, publish. Timings are optional — publishing has never required previewing or marking |
| **Player** | one reused `<audio>` element, an honest error when a file will not decode, three retries with backoff when the network drops, a transport, a queue, an immersive view, and the words over the cover |
| **Library** | loved nasheeds, your sets, play history, listening totals — rows in Postgres, so they follow you to the next device |
| **Analytics** | play beacons → per-day rollups → charts. Per-nasheed listeners and completion, per-account history, a staff dashboard at `/admin` |
| **Moderation** | report a note, three reports hide it automatically, staff resolve it — the row stays, so a thread never silently renumbers |
| **Tasbīḥ** | a dhikr counter in the sidebar — six phrases with 33 / 100 targets |
| **Search** | titles, lyric text, publishers, tags; ⌘K command palette |
| **Themes** | *dawn* (the house default) and *night garden*, both fully tokenized |

Keyboard: `Space` play/pause · `N`/`B` next/previous · `←`/`→` seek · `I` immersive ·
`L` love · `M` mute · `⌘K` palette · `/` search · `?` every shortcut. Shortcuts are ignored
while you are typing in a field, and nothing opens while an input has focus.

---

## The backend

```
        browser
   ┌──────────────────────────────────────────────────────────┐
   │  src/lib/api.ts  — the only file that talks to Supabase   │
   └───────┬──────────────────┬───────────────────┬───────────┘
           │                  │                   │
   PostgREST + RPC        Storage CDN        Edge Functions (6)
   reads, toggles,        audio, artwork     catalog · analytics
   play beacons                              publish · moderate
   ~0 invocations                            account · health
           │                  │                   │
           └──────────────────┴───────────────────┘
                              │
                        Postgres + RLS
        profiles · songs · collections · comments · loves · amens
        follows · playlists · saved_collections · reports
        play_events · song_stats_daily · site_stats_daily
        app_schema · studio_drafts · user_prefs · dhikr
```

Three ways to reach the data, chosen by cost rather than by habit:

**1. PostgREST directly** (`supabase.from(...)`) — every read and every toggle: loves,
amens, follows, playlists, notes, saved shelves. Row Level Security is the authorization,
so there is no server code to get wrong and no invocation to pay for.

**2. Postgres functions** (`supabase.rpc(...)`) — a query with rules around it. The play
beacon (`record_play`) validates, inserts the event, rolls the day up per nasheed and per
site, and moves the counter only when the listen was real. The charts (`trending`,
`daily_curve`, `song_stats`), your history (`my_history`, `my_listening`), the boot payload
(`catalog_payload`) and your whole account in one call (`my_bootstrap`) are all here. Still
zero invocations, and they run in one transaction next to the rows they read.

**3. Edge Functions** — only where a browser cannot be trusted or a cache pays for itself:

| function | verb | why it exists |
|---|---|---|
| `catalog` | GET | one cached payload for the whole home page — a thousand visitors cost one query a minute |
| `analytics` | GET | public charts (cached at the edge) and the staff dashboard (JWT checked against `profiles.role` first) |
| `publish` | POST/PATCH/DELETE | verifies the uploaded file really exists, really is yours, really is an mp3 inside 5 MB — then writes the row |
| `moderate` | POST/GET | the staff room: resolve reports, hide or delete notes, take nasheeds down, change roles |
| `account` | POST | edit a handle with a proper "already taken" error, export your data, delete the account in the right order |
| `health` | GET | is the database, storage and auth actually there — what the dashboard reads first |

Uploads never pass through a function. The browser puts the file straight into
`nasheed-audio` or `nasheed-artwork` with the caller's own JWT, and `publish` is then handed
a *path*. A 5 MB recording costs no invocation time, no function memory, and no rewrite.

### Knowing which version of itself the database is

`public.app_schema` holds one row and one string — `audio-only-2` — and the client reads it at
boot (`src/lib/schema.ts`). A project still running an older shape fails in ways that point
somewhere else entirely: the old `songs.maqam` is `NOT NULL` and the audio-only client does not
send it, so publishing dies on a column nobody can see, and `studio_drafts` does not exist yet,
so drafts save nothing. The same check covers the step from `audio-only-1` to `audio-only-2`:
`accent` and `year` are columns of a nasheed that no longer exist, so a project one migration
behind says so rather than half-working. So the app asks the database rather than guessing, and says one of:

- **behind** — "This database is an older version of CoolNasheed's schema … recordings upload,
  but publishing and drafts will fail until it is updated", with a button that copies the SQL.
- **missing** — no tables at all: the project has never been set up.
- **unknown** — the project could not be asked. Never treated as broken: a dropped connection
  must not read as a broken database.

It is a plain table rather than a function on purpose. A function that does not exist and a
function that failed look identical from the browser, and that ambiguity is exactly what makes
this class of bug take an evening to find.

### What the database does for itself

- **Counters are triggers.** Loving a nasheed inserts into `loves`; `songs.likes` moves by
  itself. Same for notes, amens and reports. A list of twenty nasheeds is one indexed read,
  not twenty aggregates.
- **Rollups beat raw events.** `play_events` is the only table that grows without bound, so
  it is the only one with a retention job: `prune_play_events(90)` runs nightly under
  `pg_cron`. The daily rollups survive, and they are what every chart reads.
- **Columns are guarded.** RLS decides *which rows* you may write; `guard_*_columns()`
  triggers decide *which columns*. Nobody promotes themselves to staff, moves a counter by
  hand, transfers a nasheed to another publisher, or back-dates a publish. Maintenance
  sessions (the service role) are exempt, because `auth.uid()` is null in them.
- **A profile arrives with the account.** `handle_new_profile()` fires on `auth.users`
  insert, derives a free handle from the email or the signup metadata, and makes the first
  account on a fresh project staff — which is how you get into `/admin` without touching SQL.
- **Ids are text, not uuid, where people read them.** `/t/sng_talaa-al-badru` beats
  `/t/7f3c…` and costs nothing to store. Publishers are addressed by handle for the same
  reason; the uuid travels beside it for foreign keys.

### The free-tier budget, and what it decided

| limit | what this app does about it |
|---|---|
| 500 MB database | events pruned after 90 days; rollups kept; no audio in the database |
| 1 GB storage | 5 MB per recording, 2 MB per cover — the browser compresses to fit, the bucket enforces it, and deleting an account gives its files back |
| 500 K function invocations | six functions, and the hot paths bypass them entirely (PostgREST + RPC) |
| 50 K monthly active users | auth is Supabase's; the catalogue and charts are cached at the edge for 60 s |
| no long-running jobs | the nightly prune is `pg_cron`, not a worker |

---

## Setting it up

**One command builds the database.** It connects, applies the five migrations, and then
checks its own work from the outside — the way a browser would:

```bash
npm install
npm run setup -- --db-url="postgres://postgres.YOUR_REF:YOUR_PASSWORD@db.YOUR_REF.supabase.co:5432/postgres"
cp .env.example .env     # your project URL + publishable key
npm run dev
```

`scripts/setup.mjs` needs one of two things and tells you which one it is missing:

| You give it | What it does with it |
| --- | --- |
| `--db-url` (or `SUPABASE_DB_URL`) | opens one Postgres connection and runs `supabase/migrations/*.sql` — a pooler URL on `:6543` is rewritten to the direct connection automatically, because DDL will not go through PgBouncer |
| `--token=sbp_…` (or `SUPABASE_ACCESS_TOKEN`) | the same SQL, through the Supabase Management API, so no database password ever leaves your laptop; a token also unlocks `--functions`, which deploys all six Edge Functions with `npx supabase functions deploy` |

The migrations are read from `supabase/migrations/` and applied in name order — never from a
list written into the script, which is how a project ends up four migrations in while the
command reports success. `--dry-run` lists the files it would run and touches nothing;
`--no-seed` skips `supabase/seed.sql`, which is empty on purpose (the catalogue is what people
upload). Neither credential is written into the repository: they are read from the flags or
the environment, used once, and gone. (The generated `supabase/setup.sql` is the state-aware
way to apply the schema — see below — and `npm run sql:bundle` regenerates it after a
migration changes.)

Afterwards it proves the result rather than trusting it, using only the *publishable* key: it
counts the tables over PostgREST, calls `catalog_payload()` the way the client does, and reads
`storage.buckets` and `pg_policies` to confirm the buckets and Row Level Security really exist.
Anything missing is printed with the reason.

**If you would rather not run a script**, `npm run sql:bundle` writes `supabase/setup.sql` —
all five migrations in one file — and you can paste it into **Supabase Studio → SQL Editor →
New query** and press Run. The app serves that same file at `/setup.sql`, and when it detects a
database that is missing the schema or one migration behind, it offers a button that copies the
whole thing to your clipboard. `npm run verify` fails if the bundled files no longer match
`supabase/migrations/`, so the paste cannot silently go stale.

**The paste is state-aware, because it lands on databases that are already half-built.** Each
migration in the file is wrapped in a guard. The guard first asks the ledger it maintains itself
(`applied_migrations`, a table the API cannot read) and then, if there is no ledger — a project
set up by `supabase db push`, or by an older copy of this file — looks for the work itself:
does `public.songs` exist, does `catalog_payload()`, is there a bucket. What is already done is
recorded and skipped rather than attempted and failed. That matters because re-running the
earlier migrations on a database that has the newest one *cannot* work: migration 2's
`trending()` body selects `songs.maqam`, which migration 5 drops. `npm run sql:test` proves the
four states that matter: a fresh project, a project one migration behind, the same file pasted
twice, and a project built by the CLI with no ledger at all.

**The Edge Functions are optional.** Every call the client makes has a second road beside it:
`catalog` → `catalog_payload()`, `analytics?view=admin` → `admin_summary()`, `moderate` →
PostgREST under the staff policies plus `resolve_report()`, `publish` → the browser builds the
row and PostgREST inserts it under `owner_id = auth.uid()`. Row Level Security is the authority
in both cases, so the direct road is not a weaker road — it is the same road without the door.
A project with tables and no functions can publish, comment, moderate and read its dashboard.
The one thing that genuinely needs a function is **deleting an account**, because `auth.users`
needs the secret key and a browser must never hold it; the app says exactly that instead of
failing quietly.

### The Edge Functions, by hand

`npm run setup -- --functions --token=sbp_…` does all of this and then calls the functions
back to prove they answer. Doing it yourself is four commands, and needs no Docker:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_…      # Account → Access Tokens

npx supabase secrets set SUPABASE_SECRET_KEY=sb_secret_… --project-ref YOUR_REF
npx supabase functions deploy --project-ref YOUR_REF --use-api

# the two a signed-out browser calls — both should answer 200
curl -s "$VITE_SUPABASE_URL/functions/v1/health"  -H "apikey: $VITE_SUPABASE_ANON_KEY"
curl -s "$VITE_SUPABASE_URL/functions/v1/catalog" -H "apikey: $VITE_SUPABASE_ANON_KEY"
```

`--use-api` bundles server-side; without it the CLI looks for Docker. The secret key is the
one thing a function holds that a browser must not — it is what lets `account` delete a user
from `auth.users`; every other function works without it. Which functions demand a real
session is decided in `supabase/config.toml` (`verify_jwt`): `catalog`, `analytics` and
`health` are open, `publish`, `moderate` and `account` are not, and the CLI reads that file
when it deploys. If a function ever answers `401` to the publishable key, redeploy it with
`--no-verify-jwt`.

**Everything local, with Docker** (the Supabase CLI runs the whole stack):

```bash
npx supabase start          # pulls images, starts Postgres on :54322
npx supabase db reset       # migrations, in order
npx supabase functions serve
cp .env.example .env        # paste the URL + anon key that `supabase status` prints
npm run dev
```

Then in the dashboard: **Authentication → Providers → Email** on (with *Confirm email* off for
a local project — the app handles both, and an unconfirmed signup says "check your inbox"
instead of failing); **Authentication → URL Configuration → Site URL** set to wherever you host
the client. `pg_trgm` and `pg_cron` are enabled by the migrations themselves.

Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`, or in your host's environment
screen. Both are public by design — the anon key is the key a browser is meant to hold, and RLS
decides what it may do. The `service_role` key belongs to the functions and never appears in
the client bundle.

**Deploying the client:** any static host. `npm run build` produces `dist/`; there is no server
process to run, no proxy to configure, and no rewrite rules beyond the usual single-page-app
fallback. `predev` and `prebuild` regenerate the SQL bundle, so the copy the app offers is
always the copy of the schema in the repository.

---

## The studio

Publishing is five steps and none of them is a ritual:

1. **The recording** — an `.mp3` up to 5 MB. A larger file is re-encoded in the browser at the
   best bitrate that fits and uploaded from there; a file that already fits is sent untouched.
2. **Cover art, if you have any** — optional. Anything over 2 MB is shrunk to fit (WebP, then
   JPEG) before it uploads.
3. **What it is** — title, a transliteration or Arabic title, a note, and up to eight tags.
4. **The words** — a line per line, optional translation.
5. **Publish** — with a checklist that says exactly what is still missing, on the button, before
   it is pressed: a recording attached, a title, at least one line of the words. Timings are a
   nicety, not a requirement: you never have to press play or use "mark" to publish.

Drafts save as you type and the header says which of the three things is true — "saving…",
"draft saved 2m ago", or **"Not saved — retry"** with the actual reason. A save that fails is
never silent, and a tab closed mid-typing flushes what was still queued. Every refusal names
the real missing thing: a recording that is missing says *upload the mp3 in step 1*, and an old
database says *the database is an older version*, never a Postgres constraint name. Internal
sentences — "the function answered undefined" and its kind — cannot reach the screen.

---

## Design

The house is bound in *dawn* — cream ground, deep emerald ink — with the *night garden*
(a near-black emerald ground, jade light, aged gold for anything sacred or quoted, ivory for
text, turquoise and madder held back as accents) one toggle away. `index.html` reads the
device's choice before React exists, so the first paint is the right one; a device that has
never chosen gets dawn, whatever the account's saved row says.

```
night   bg #070F0C   jade #2FBF8F   gold #D9B871   ivory #F2ECE0   turq #35B7B0   madder #C4644A
dawn    bg #F4EFE3   jade #148A63   gold #9D7A2C   ink  #16211C
```

Colors live as CSS custom properties under `:root[data-theme]` and are exposed to Tailwind v4
through `@theme`, so components say `text-jade` / `bg-surface2` and the whole app re-skins on
one attribute. Type pairs a display serif for poetry with a neutral sans for chrome; Arabic is
set RTL with its own size scale.

**A picture is a dark room in both themes.** Any surface that writes over artwork — a hero
panel, a cover card, the full-screen player — carries `over-art`, which pins the surface, text
and accent tokens inside it back to the night book: the scrim under a photograph stays near-black
because the photograph does not get brighter when the page does. Covers cast `--shadow-art`, which
is a black bloom at night and a soft green-tinted one in daylight, rather than a hard black smear
on cream.

**Elevation is a token too.** Everything that floats — frosted glass, a card on hover, the nav
pill, the dimmer behind a dialog — takes its shadow and its veil from `--shadow-lift` and `--scrim`.
At night those are black; in the light book they are the same green the rest of it is drawn in, so
nothing on a cream page is accidentally wearing the night book's wardrobe.

**Cover art is either uploaded or absent.** When a publisher has not uploaded an image, the
nasheed gets a plain accent tile with the first letter of its title. Nothing is generated from
a seed and nothing pretends to be artwork: a nasheed without cover art looks like a nasheed
without cover art, which is what it is.

**Motion is material, not slideshow.** Switching pages mounts a frosted veil over the reading
area for ~520 ms that blurs the outgoing page and clears as the new one settles — a blur that
appears and goes away, not the usual fade or slide. The top bar carries a painted dissolve at
its foot rather than a hairline border. Tabs use a shared lens that travels between them, and
every microinteraction is a scale/opacity change on a token-driven curve. `prefers-reduced-motion`
turns all of it off.

---

## Layout

```
supabase/
  migrations/  core schema + triggers · Postgres functions · RLS policies + grants ·
               storage buckets · audio-only shape + app_schema (6 migrations,
               version audio-only-2)
  functions/   catalog · analytics · publish · moderate · account · health
    _shared/     cors, json/errors, db clients, auth, validation, cache, song mappers
  seed.sql     intentionally empty — the catalogue is what people upload
  setup.sql    every migration in one file, for the SQL editor (generated, committed)
  setup-schema.sql   the same, without the seed section
  config.toml  what `supabase start`, `db push` and `functions deploy` read
shared/
  types.ts     the wire contract — imported by the browser, by Deno and by the suites
  fixtures/    publish-cases.json — the one contract both publish validators answer to
src/
  lib/         api.ts (the only file that talks to Supabase), supabase.ts (client, storage
               paths, function invocation), wire.ts (rows → models), schema.ts (which version
               the database is), boot.ts, beacon.ts, compress.ts (image + audio shrinkers),
               errors.ts, hooks.ts, format.ts, math.ts
    audio/       player.ts — one media element, retries, the honest error
  data/        types.ts, catalog.ts (the registry the whole app reads), preview.ts
  store/       player.ts, library.ts, session.ts, community.ts, studio.ts, ui.ts — zustand
  components/  layout, player, track, collection, auth, art, ui primitives, tasbīḥ,
               command palette, shortcuts
  pages/       Home, Search, Library, Queue, About, Collection, Playlist, Artist, Track,
               Studio, Profile, Admin, 404
scripts/
  setup.mjs        `npm run setup` — builds a real Supabase project, then verifies it
  sql-bundle.mjs   migrations + seed → supabase/setup.sql and public/setup.sql
                   (`--check` fails if they are stale; `npm run verify` runs it)
  pg-test.mjs      the database suite: real Postgres in WebAssembly
  contract.ts      the publish validator and the row mapper, on both sides of the fence
  functions-bundle.mjs   the six Edge Functions, bundled without Deno
  smoke.tsx        headless suite (jsdom)
```

Stack: Vite 7 · React 19 · TypeScript (strict) · Tailwind CSS v4 · react-router v7 ·
zustand 5 · supabase-js 2 · Supabase (Postgres, Auth, Storage, Edge Functions).

Two projects are typechecked: `tsconfig.json` for the app (`strict`, `noUnusedLocals`,
`noUnusedParameters`) and `tsconfig.scripts.json`, which adds Node types so the suites are
checked too. `npm run typecheck` runs both; `npm run build` refuses to bundle unless they
pass. The Edge Functions are Deno, checked with `npm run functions:check`.

### The suites

`npm run sql:test` runs the migrations and Row Level Security against a **real Postgres** —
[PGlite](https://pglite.dev), Postgres compiled to WebAssembly, so there is no Docker and no
server, just the same planner, triggers and policies. It shims the three things PGlite is not
Supabase for (`auth.users` + `auth.uid()`/`auth.jwt()`/`auth.role()` reading the same request
GUCs, `storage.buckets`/`storage.objects`, and the anon / authenticated / service_role roles),
then signs up accounts, plays nasheeds, loves and notes and reports them, publishes straight
through PostgREST, and asserts the wire shape the client reads — every key of
`catalog_payload()`, `trending()`, `daily_curve()`, `song_stats()`, `my_history()`,
`my_bootstrap()` and `admin_summary()` — plus the things that are easy to get wrong silently:
that the buckets accept mp3 and only mp3, that a nasheed cannot go live without a recording,
that `app_schema` is readable by anyone and writable by nobody — and then the four states the
setup file has to survive: pasted onto a fresh project, onto one that is a migration behind,
onto one that already has everything (twice, for good measure), and onto one built by the CLI
where the file has to work out for itself what has already been done.
Current run: **137 checks.**

Publishing has two validators, and a pair of hand-written mirrors is a pair that drifts, so
`npm run contract:test` holds both to `shared/fixtures/publish-cases.json` (24 cases, 2 stored rows):
`scripts/contract.ts` reads it from the browser side (`songRowFromInput` / `songFromRow`,
bundled by esbuild) and `supabase/functions/_shared/contract_test.ts` reads it from the Deno
side (`deno test`), each asserting the same accepted rows, the same refusals with the same
status and field, and the same stored-row → model mapping — and `scripts/contract.ts` runs
*both* mappers under Node as well, so the function's side is checked on a machine with no
Deno installed too. `pg-test.mjs` closes the loop by
inserting those rows into a real `public.songs` **as a listener**, which proves they satisfy
the CHECK constraints and that the column grants cover exactly what a publisher needs.
Current run: **28 checks** — the same fixture through the browser's mapper and through
the function's, because a row that reads differently depending on which road it took is
exactly the drift this is here to catch.

`npm run smoke` bundles the app's logic with esbuild and runs it in jsdom against a project
that does not exist, so every failure path is a real one: the empty catalogue, the schema
probe behind a stubbed `fetch`, error translation (`apiErrorFromDb`) against the exact rows
Postgres returns, draft saving that succeeds, fails, and is flushed while a tab goes away,
the copyable repair SQL (including that every migration in it is guarded, since it is pasted
onto databases that are part-way through), the lyric view, the player's retry and error paths,
the words over the cover — the stage that lays the lines over the artwork, seeks when a line is
tapped, keeps its own dark ground in either theme, and steps back one place on `Escape` — the
account gates, the keyboard staying out of the way while you type, the focus landing on the
first field of a dialog rather than its Close button, toasts, upload fitting, and every route
rendering.
Current run: **177 checks.**

`npm run functions:bundle` bundles all six Edge Functions with the esbuild that is already a
dependency, which proves every file parses and every import resolves on a machine with no Deno
— and refuses a database row cast straight to `Song`, the bug that made the publish function
tell an owner that their own nasheed belonged to somebody else, and tell a publisher editing a
title that their nasheed needed an mp3. `npm run functions:check` is the real check (types and
the Deno contract test) where Deno exists.

`npm run verify` runs all of it: typecheck → contract → database → bundle freshness → functions
→ build → smoke.

---

## Content notes

Read this before you reuse anything here.

- **Every recording in a deployed instance is one somebody uploaded.** The repository ships no
  audio, no catalogue and no seed data: the fictional nasheeds, invented publishers and
  generated statistics that an earlier version shipped were deleted in migration 5 and are not
  coming back.
- **The texts are real where they are marked real.** The interface supports source notes, and
  Qurʾānic quotations are attributed to their sūra and verse, flagged in the lyric view.
- **Nothing depicts the Prophet ﷺ**, and honorifics are used wherever he is mentioned.
- **No music is generated, and none is synthesized.** Beats are haram to this project, so there
  is no oscillator bank, no drum machine, no reverb invented at runtime — the app is one media
  element playing one file, and the only way a file gets there is a person uploading it.

## Not done / next

- Playlists are private. Making one public is a `select` policy on `playlists` and a share
  route — the table already carries everything a public page would need.
- Search is `ilike` plus a trigram index. Postgres full-text with an Arabic-aware
  configuration would be better, and would still cost nothing to run.
- Realtime is enabled for notes, amens and nasheed counters but the client does not
  subscribe yet — a thread updates when you open it, not while you watch it.
- The split into per-page chunks is coarse: the studio and admin pages belong in their own
  lazy chunks once there is a reason to care about the first paint again.
- The only external requests are to your Supabase project and the Google Fonts stylesheet in
  `index.html` (Marcellus, Plus Jakarta Sans, Amiri). Every family has a local fallback, and
  there is no telemetry of any kind.
