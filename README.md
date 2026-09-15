# CoolNasheed — vocals of light

A streaming home for nasheeds, built like Spotify or SoundCloud but shaped around what a
nasheed actually is: devotional poetry, a maqām, a voice, and a frame drum.

The backend is **Supabase on the free tier** — Postgres with Row Level Security, Supabase
Auth, Storage for recordings and cover art, and six Edge Functions for the handful of jobs
that genuinely need a server. The client talks to the database directly for almost
everything, which is the only way a free tier survives real traffic.

Every nasheed is **a real recording**. An account uploads it, the browser puts the file
straight into Supabase Storage, and everybody else streams it back from there. Nothing is
synthesized, nothing is imitated, and no catalogue ships with the client — an empty database
means empty shelves, which the pages say out loud rather than filling with invented
nasheeds. The maqām and the words travel beside the audio as metadata, and the lyric view
follows the recording: exactly, when the publisher set the second each line starts, and
evenly spread across the track when they did not.

```
npm install
cp .env.example .env      # add your project URL + anon key (or skip: demo mode works)
npm run dev               # http://localhost:5173
npm run smoke             # headless suite — no browser, no project needed
npm run sql:test          # the migrations, the RPCs and RLS, run against real Postgres
npm run verify            # typecheck + the database + the build + the smoke suite
```

---

## What's in it

| | |
|---|---|
| **Catalogue** | whatever accounts publish — nasheeds, publishers, shelves, tags and 10 maqāmāt, all of it rows in Postgres |
| **Accounts** | Supabase Auth (email + password). Listening, searching and reading never need one; loving, noting, following, publishing and moderating do |
| **Synced lyrics** | per-word karaoke fill, three scripts (transliteration / العربية / English), line rail, translations, source notes for Qurʾān and public-domain lines |
| **Studio** | attach a recording, write the words (transliteration, العربية, English), set the maqām, the tags and — if you have them — the second each line starts, preview the file you are about to publish, then publish it |
| **Immersive player** | full-screen: procedural artwork, a live spectrum off the audio element, lyrics / queue / translation tabs |
| **Nūr** | an on-device curator that builds mixes and explains every pick — *"Stays in Ḥijāz — the mode you keep returning to, 2.4 points of it."* |
| **Library** | loved nasheeds, your sets, play history, listening totals — rows in Postgres, so they follow you to the next device |
| **Analytics** | play beacons → per-day rollups → charts. Per-nasheed listeners and completion, per-account history, and a staff dashboard at `/admin` |
| **Moderation** | report a note, three reports hide it automatically, staff resolve it — the row stays, so a thread never silently renumbers |
| **Tasbīḥ** | a dhikr counter in the sidebar — six phrases with 33 / 100 targets, a vibration pulse when you land on the target |
| **Search** | titles, lyric text, publishers, maqāmāt, tags; ⌘K command palette |
| **Themes** | *night garden* (default) and *dawn*, both fully tokenized |

Keyboard: `Space` play/pause · `N`/`B` next/previous · `←`/`→` seek · `I` immersive ·
`L` love · `M` mute · `⌘K` palette · `/` search · `G` ask Nūr for a mix · `?` all shortcuts.

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
| `publish` | POST/PATCH/DELETE | verifies the uploaded file really exists, really is yours, really is inside the bucket limits — then writes the row |
| `moderate` | POST/GET | the staff room: resolve reports, hide or delete notes, take nasheeds down, change roles |
| `account` | POST | edit a handle with a proper "already taken" error, export your data, delete the account in the right order |
| `health` | GET | is the database, storage and auth actually there, and has anything been published — what the dashboard reads first |

Uploads never pass through a function. The browser puts the file straight into
`nasheed-audio` or `nasheed-artwork` with the caller's own JWT, and `publish` is then handed
a *path*. A 40 MB recording costs no invocation time, no function memory, and no rewrite.

### What the database does for itself

- **Counters are triggers.** Loving a nasheed inserts into `loves`; `songs.likes` moves by
  itself. Same for notes, amens and reports. A list of twenty nasheeds is one indexed read,
  not twenty aggregates.
- **Rollups beat raw events.** `play_events` is the only table that grows without bound, so
  it is the only one with a retention job: `prune_play_events(90)` runs nightly under
  `pg_cron`. The daily rollups survive, and they are what every chart reads.
- **Columns are guarded.** RLS decides *which rows* you may write; `guard_*_columns()`
  triggers decide *which columns*. Nobody promotes themselves to staff, moves a counter by
  hand, transfers a nasheed to another publisher, or back-dates a publish. The service role
  is exempt, because `auth.uid()` is null in it.
- **A profile arrives with the account.** `handle_new_profile()` fires on
  `auth.users` insert, derives a free handle from the email or the signup metadata, and makes
  the first account on a fresh project staff — which is how you get into `/admin` without
  touching the SQL editor.
- **Ids are text, not uuid, where people read them.** `/t/sng_talaa-al-badru` beats
  `/t/7f3c…` and costs nothing to store. Publishers are addressed by handle for the same
  reason; the uuid travels beside it for foreign keys.

### The free-tier budget, and what it decided

| limit | what this app does about it |
|---|---|
| 500 MB database | events pruned after 90 days; rollups kept; no audio in the database |
| 1 GB storage | 60 MB per recording, 8 MB per cover, both enforced on the bucket; deleting an account gives its files back |
| 500 K function invocations | six functions, and the hot paths bypass them entirely (PostgREST + RPC) |
| 50 K monthly active users | auth is Supabase's; the catalogue and charts are cached at the edge for 60 s |
| no long-running jobs | the nightly prune is `pg_cron`, not a worker |

---

## Setting it up

**One command builds the database.** It connects, applies the four migrations, and then
checks its own work from the outside — the way a browser would:

```bash
npm install
npm run setup -- --db-url="postgres://postgres.YOUR_REF:YOUR_PASSWORD@db.YOUR_REF.supabase.co:5432/postgres"
cp .env.example .env     # your project URL + publishable key
npm run dev
```

That is the whole backend. `scripts/setup.mjs` needs one of two things and tells you which
one it is missing:

| You give it | What it does with it |
| --- | --- |
| `--db-url` (or `SUPABASE_DB_URL`) | opens one Postgres connection and runs `supabase/migrations/*.sql` — a pooler URL on `:6543` is rewritten to the direct connection automatically, because DDL will not go through PgBouncer |
| `--token=sbp_…` (or `SUPABASE_ACCESS_TOKEN`) | the same SQL, through the Supabase Management API, so no database password ever leaves your laptop; a token also unlocks `--functions`, which deploys all six Edge Functions with `npx supabase functions deploy` |

Neither credential is written into the repository — they are read from the flags or the
environment, used once, and gone. Everything it runs is safe to run twice: every statement
is `if not exists` / `or replace`, so re-running `npm run setup` after a change is the
normal thing to do.

Afterwards it proves the result rather than trusting it, using only the *publishable* key:
it counts `songs`, `publishers` and `collections` over PostgREST, calls `catalog_payload()`
the way the client does, and reads `storage.buckets` and `pg_policies` to confirm the
buckets and Row Level Security really exist. Anything missing is printed with the reason.
`--dry-run` lists the files it would run and stops.

**If you would rather not run a script**, `npm run sql:bundle` writes `supabase/setup.sql`
— the four migrations in one file — and you can paste it into **Supabase Studio → SQL
Editor → New query** and press Run. It is the same work by hand.

**The Edge Functions are optional.** Every call the client makes has a second road beside
it: `catalog` → `catalog_payload()`, `analytics?view=admin` → `admin_summary()`,
`moderate` → PostgREST under the staff policies plus `resolve_report()`, `publish` →
the browser builds the row and PostgREST inserts it under `owner_id = auth.uid()`. Row
Level Security is the authority in both cases, so the direct road is not a weaker road —
it is the same road without the door. A project with tables and no functions can publish,
comment, moderate and read its dashboard. The one thing that genuinely needs a function is
**deleting an account**, because `auth.users` needs the secret key and a browser must never
hold it; the app says exactly that instead of failing quietly.

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

**Everything local, with Docker** (the Supabase CLI runs the whole stack — database, auth,
storage, functions, studio), if that is the machine you are on:

```bash
npx supabase start          # pulls images, starts Postgres on :54322
npx supabase db reset       # the four migrations, in order
npx supabase functions serve
cp .env.example .env        # paste the URL + anon key that `supabase status` prints
npm run dev
```

Then in the dashboard: **Authentication → Providers → Email** on (with *Confirm email* off
for a demo — the app handles both, and an unconfirmed signup says "check your inbox" instead
of failing); **Authentication → URL Configuration → Site URL** set to wherever you host the
client. `pg_trgm` and `pg_cron` are enabled by the migrations themselves.

Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`, or in your host's
environment screen. Both are public by design — the anon key is the key a browser is meant
to hold, and RLS decides what it may do. The `service_role` key belongs to the functions and
never appears in the client bundle.

**Deploying the client:** any static host. `npm run build` produces `dist/`; there is no
server process to run, no proxy to configure, and no rewrite rules beyond the usual
single-page-app fallback.

### Without any of that

A database with no nasheeds in it is the normal state of a fresh project, and the app says
so rather than filling the room: the shelves are empty, the home page points at the Studio,
and the staff room shows what the database does hold.

No credentials, no problem. With no project configured the app still boots: every page
renders, the tasbīḥ and the preferences still persist on the device, and every
account-gated action explains that it needs a project rather than failing mysteriously.
Nothing is invented to make the room look fuller.

---

## How a nasheed gets heard

```
the studio            ──►  Storage (nasheed-audio/, nasheed-artwork/)   ──►  a browser
  lines, maqām, tags        the file, uploaded with the caller's own JWT      <audio>
  + the recording     ──►  publish()  ──►  songs row                          streams it
                                              │                                   │
                                              ▼                                   ▼
                                     catalog_payload()                     Lyrics.tsx
                                     (one cached call hydrates             (timings, or
                                      the whole catalogue)                  spread evenly)
```

The client holds one `<audio>` element and one `AudioContext` for its analyser. There is no
scheduler to keep and no note graph to rebuild: the element is the clock, `timeupdate` and a
frame loop read it, and everything downstream — the seek bar, the lyric view, the visualizer,
the play beacon — is driven from that one number.

- **Timings are the publisher's.** A line may carry `t`, the second it starts. Where those
  exist the lyric view is exact; where they do not, `src/lib/lyrics.ts` spreads the lines
  evenly across the recording and the lyric footer says which one you are reading.
- **Maqāmāt are metadata.** Ten scales with real quarter tones — Rāst
  `[0, 2, 3.5, 5, 7, 9, 10.5]`, Bayātī, Ḥijāz, Nahāwand, Kurd, ʿAjam, Ṣabā, Nikrīz,
  Ḥijāzkār, ʿUsshāq. They are what you browse and filter by, and what Nūr reasons about.
  Nothing in the app turns them into sound.
- **Length comes from the upload.** The browser reads the file's duration before publishing
  and stores it as `duration_ms`, so a shelf can print its running time without anyone
  streaming the audio first.
- **Counts come from the database.** One `play_events` row per listen, rolled up per nasheed
  and per day; the charts read the rollups and the raw events are pruned after 90 days.

---

## Design

The palette is a night garden: near-black emerald ground, jade light, aged gold for anything
sacred or quoted, ivory for text, with turquoise and madder held back as accents.

```
night   bg #070F0C   jade #2FBF8F   gold #D9B871   ivory #F2ECE0   turq #35B7B0   madder #C4644A
dawn    bg #F4EFE3   jade #148A63   gold #9D7A2C   ink  #16211C
```

Colors live as CSS custom properties under `:root[data-theme]` and are exposed to Tailwind v4
through `@theme`, so components say `text-jade` / `bg-surface2` and the whole app re-skins on
one attribute. Type pairs a display serif for poetry with a neutral sans for chrome; Arabic is
set RTL with its own size scale.

**Artwork is generated, never downloaded.** `src/lib/art/pattern.ts` seeds a deterministic
pattern from the nasheed's id and draws Islamic geometry as SVG — star rosettes, girih
strapwork, mashrabiya arcs, zellige tiling — which `PatternArt` renders at any size. A
publisher who uploads a cover replaces it; everybody else gets a pattern that no other
nasheed has, and the same nasheed always looks the same.

---

## Layout

```
supabase/
  migrations/  core schema + triggers · Postgres functions · RLS policies + grants ·
               storage buckets and their policies
  functions/   catalog · analytics · publish · moderate · account · health
    _shared/     cors, json/errors, db clients, auth, validation, cache, song mappers
  setup.sql    the four migrations in one file, for the SQL editor
  config.toml  what `supabase start`, `db push` and `functions deploy` read
shared/
  types.ts     the wire contract — imported by the browser and by Deno
src/
  lib/         maqām theory, lyric timings, prng, formatting
    api.ts       the only file that talks to Supabase
    supabase.ts  client, storage paths, function invocation
    wire.ts      database rows → app models
    beacon.ts    the play beacon: what counts as a listen, and when it is reported
    boot.ts      catalogue → session → library, once, without blocking first paint
    audio/       player.ts — one audio element and its analyser
    lyrics.ts    line timings: the publisher's, or spread evenly
    art/         procedural geometric patterns
    nur.ts       the curator: taste vectors, seeded mixes, reasons
  data/        types.ts, catalog.ts (the live registry: tracks, publishers, sets, search)
  store/       player.ts (transport + queue), library.ts (loved, sets, history, settings),
               session.ts (auth), community.ts (the thread under a nasheed),
               studio.ts (drafts, attachments, publishing), ui.ts — zustand
  components/  layout, player (lyrics, visualizer, transport, immersive), track, collection,
               auth, art, ui primitives, tasbīḥ, Nūr panel, command palette, shortcuts
  pages/       Home, Search, Library, Queue, About, Collection, Playlist, Artist, Track,
               Studio, Profile, Admin, 404
scripts/
  setup.mjs        `npm run setup` — builds a real Supabase project, then verifies it
  sql-bundle.mjs   migrations → supabase/setup.sql
  pg-test.mjs      the database suite: real Postgres in WebAssembly
  smoke.tsx        headless suite (jsdom, a fake <audio> clock, a fake analyser)
```

Stack: Vite 7 · React 19 · TypeScript (strict) · Tailwind CSS v4 · react-router v7 ·
zustand 5 · supabase-js 2 · Supabase (Postgres, Auth, Storage, Edge Functions).

Two projects are typechecked: `tsconfig.json` for the app (`strict`, `noUnusedLocals`,
`noUnusedParameters`) and `tsconfig.scripts.json`, which adds Node types so the generator and
the suite are checked too. `npm run typecheck` runs both; `npm run build` refuses to bundle
unless they pass. The Edge Functions are Deno, checked with `npm run functions:check`.

`npm run sql:test` runs the four migrations, every RPC and Row Level Security against a
**real Postgres** — [PGlite](https://pglite.dev), Postgres compiled to WebAssembly, so there
is no Docker and no server, just the same planner, triggers and policies. It shims the
three things PGlite is not Supabase for (`auth.users` + `auth.uid()`/`auth.jwt()`/`auth.role()`
reading the same request GUCs, `storage.buckets`/`storage.objects`, and the anon /
authenticated / service_role roles), brings its own fixture (two publishers, two listeners,
four nasheeds, two weeks of charts — the database itself ships empty), then signs up
accounts, plays nasheeds, loves and notes and reports them, publishes one straight through
PostgREST, and asserts the wire shape the client reads: every key of `catalog_payload()`,
`trending()`, `daily_curve()`, `song_stats()`, `my_history()`, `my_bootstrap()` and
`admin_summary()`. It is 117 checks, the last of them being the whole bundle applied a
second time, because that is what the setup file promises. It is not a formality — it found
four things that would have shipped broken:

Publishing has one validator, and it runs on the server: `supabase/functions/_shared/validate.ts`
is the only place a publish payload is checked, and the Edge Function is the only writer for
publish, update and remove. `pg-test.mjs` closes the loop by inserting the rows that validator
produces into a real `public.songs` **as a listener** — which proves they satisfy the CHECK
constraints and that the column grants cover exactly what a publisher needs — and by asserting
that the schema itself refuses a maqām outside the ten, a one-character title, a recording
shorter than a second, and more than forty lines. `npm run verify` runs the lot.

- the BEFORE-UPDATE guards were freezing the counters the AFTER triggers maintain, so
  `plays`, `likes`, `notes` and `amens` never moved (a guard cannot tell a client from a
  security-definer trigger; column privileges can, and now do that job instead)
- the same guard was putting the first account's `role = 'staff'` straight back, so nobody
  would ever have reached the staff room
- three reports hid a note at **two**, because the auto-hide re-counted a counter the
  statement above it had already incremented
- `my_history()` ordered by a column that only exists in its camelCase alias, so the
  "recently played" rail would have thrown on every call

`npm run smoke` bundles the suite with esbuild and runs it under Node, against jsdom with a
fake `<audio>` clock and a fake analyser. It starts from the empty registry — proves the
home page says so instead of inventing a shelf — then hydrates it the way the client does
and validates the integrity of what lands (no orphan nasheeds, no dangling publishers,
shelves linked back, durations and counters read straight off the rows), the lyric timings
(publisher timings used as they stand, untimed lines spread evenly, every word inside its
line), maqām reference including quarter tones, search, and Nūr's determinism. Then the
player: load, play, seek, pause, clamp the volume, run to the end and fire `onEnded`, with
the analyser wired up. Then every route, the lyric view (line count, karaoke spans, rail
seeking), and the account gate: with nobody signed in, loving a nasheed and building a set
must be refused, must open the sign-in sheet, and must write nothing — while the tasbīḥ, the
preferences and the local history mirror still survive a reload, keys an older save never
wrote fall back to their defaults, and a stale id degrades quietly instead of breaking the
library page.
Current run: **every check passes, 0 failures.**

---

## Content notes

Read this before you reuse anything here.

- **Every recording belongs to whoever uploaded it.** The app ships with no audio of its
  own: a nasheed exists because an account published it, and it is credited to that account.
- **No nasheed, no note, no play count is invented.** The counters on a track page are rows
  in Postgres, and the notes under a nasheed were written by accounts. An empty shelf is
  empty.
- **The texts are the publisher's responsibility, and the fields are there for it.** Each
  line may carry an attribution; Qurʾānic quotations are meant to be marked with their sūra
  and verse, and the lyric view flags them.
- **Nothing depicts the Prophet ﷺ**, and honorifics are used wherever he is mentioned.

## Not done / next

- Playlists are private. Making one public is a `select` policy on `playlists` and a share
  route — the table already carries everything a public page would need.
- Search is `ilike` plus a trigram index. Postgres full-text with an Arabic-aware
  configuration would be better, and would still cost nothing to run.
- Nūr's taste vectors are heuristics over your history and loves, not a model. They run
  on-device, on data you already have, and every pick comes with its reason.
- Realtime is enabled for notes, amens and nasheed counters but the client does not
  subscribe yet — a thread updates when you open it, not while you watch it.
- The only external requests are to your Supabase project and the Google Fonts stylesheet in
  `index.html` (Marcellus, Plus Jakarta Sans, Amiri). Every family has a local fallback, and
  there is no telemetry of any kind.
