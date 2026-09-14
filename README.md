# CoolNasheed — vocals of light

A streaming home for nasheeds, built like Spotify or SoundCloud but shaped around what a
nasheed actually is: devotional poetry, a maqām, a voice, and a frame drum.

The backend is **Supabase on the free tier** — Postgres with Row Level Security, Supabase
Auth, Storage for recordings and cover art, and six Edge Functions for the handful of jobs
that genuinely need a server. The client talks to the database directly for almost
everything, which is the only way a free tier survives real traffic.

The audio is two things at once. The catalogue ships as **compositions** that a Web Audio
engine in your browser performs live — formant-filtered voices, a synthesized duff, a
generated convolution reverb — and any account can **upload a real recording**, which is
stored in Supabase Storage and streamed from its CDN. Nothing here pretends otherwise: the
synthesized voices are labeled as synthesized, and the reciters in the bundled catalogue are
fictional.

```
npm install
cp .env.example .env      # add your project URL + anon key (or skip: demo mode works)
npm run dev               # http://localhost:5173
npm run smoke             # headless suite — no browser, no project needed
npm run sql:test          # the migrations + seed + RLS, run against real Postgres
npm run verify            # typecheck + the database + the build + the smoke suite
```

---

## What's in it

| | |
|---|---|
| **Catalogue** | 24 nasheeds, 8 publishers, 9 collections, 8 moods, 10 maqāmāt — seeded into Postgres by `supabase/seed.sql` |
| **Accounts** | Supabase Auth (email + password). Listening, searching and reading never need one; loving, noting, following, publishing and moderating do |
| **Synced lyrics** | per-word karaoke fill, three scripts (transliteration / العربية / English), line rail, translations, source notes for Qurʾān and public-domain lines |
| **Studio** | write a nasheed (lines, maqām, tempo, voices, drum pattern), preview it with the same engine everybody hears, record or upload audio, publish it to the catalogue |
| **Immersive player** | full-screen: procedural artwork, live visualizer, lyrics / queue / translation tabs |
| **Nūr** | an on-device curator that builds mixes and explains every pick — *"Stays in Ḥijāz — the mode you keep returning to, 2.4 points of it."* |
| **Library** | loved nasheeds, your sets, play history, listening totals — rows in Postgres, so they follow you to the next device |
| **Analytics** | play beacons → per-day rollups → charts. Per-nasheed listeners and completion, per-account history, and a staff dashboard at `/admin` |
| **Moderation** | report a note, three reports hide it automatically, staff resolve it — the row stays, so a thread never silently renumbers |
| **Tasbīḥ** | a dhikr counter in the sidebar — six phrases with 33 / 100 targets, a vibration pulse when you land on the target |
| **Search** | titles, lyric text, publishers, maqāmāt, tags; ⌘K command palette |
| **Themes** | *night garden* (default) and *dawn*, both fully tokenized |

Keyboard: `Space` play/pause · `N`/`B` next/previous · `←`/`→` seek · `I` immersive ·
`L` love · `D` duff on/off (vocals only) · `M` mute · `⌘K` palette · `/` search ·
`G` ask Nūr for a mix · `?` all shortcuts.

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
| `health` | GET | is the database, storage, auth and the seed actually there — what the dashboard reads first |

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
  hand, transfers a nasheed to another publisher, or back-dates a publish. Maintenance
  sessions (the seed script, the service role) are exempt, because `auth.uid()` is null in
  them.
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

**One command builds the database.** It connects, applies the four migrations, seeds the
catalogue, and then checks its own work from the outside — the way a browser would:

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
| `--db-url` (or `SUPABASE_DB_URL`) | opens one Postgres connection and runs `supabase/migrations/*.sql` then `supabase/seed.sql` — a pooler URL on `:6543` is rewritten to the direct connection automatically, because DDL will not go through PgBouncer |
| `--token=sbp_…` (or `SUPABASE_ACCESS_TOKEN`) | the same SQL, through the Supabase Management API, so no database password ever leaves your laptop; a token also unlocks `--functions`, which deploys all six Edge Functions with `npx supabase functions deploy` |

Neither credential is written into the repository — they are read from the flags or the
environment, used once, and gone. Everything it runs is safe to run twice: the migrations
are `if not exists` / `or replace`, and every seed insert is `on conflict do nothing`, so
re-running `npm run setup` after a change is the normal thing to do.

Afterwards it proves the result rather than trusting it, using only the *publishable* key:
it counts `songs`, `publishers` and `collections` over PostgREST, calls `catalog_payload()`
the way the client does, and reads `storage.buckets` and `pg_policies` to confirm the
buckets and Row Level Security really exist. Anything missing is printed with the reason.
`--dry-run` lists the files it would run and stops; `--no-seed` builds the tables and leaves
the room empty.

**If you would rather not run a script**, `npm run sql:bundle` writes `supabase/setup.sql`
— the same four migrations plus the seed in one file — and you can paste it into
**Supabase Studio → SQL Editor → New query** and press Run. It is the same work by hand.

**The Edge Functions are optional.** Every call the client makes has a second road beside
it: `catalog` → `catalog_payload()`, `analytics?view=admin` → `admin_summary()`,
`moderate` → PostgREST under the staff policies plus `resolve_report()`, `publish` →
the browser builds the row and PostgREST inserts it under `owner_id = auth.uid()`. Row
Level Security is the authority in both cases, so the direct road is not a weaker road —
it is the same road without the door. A project with tables and no functions can publish,
comment, moderate and read its dashboard. The one thing that genuinely needs a function is
**deleting an account**, because `auth.users` needs the secret key and a browser must never
hold it; the app says exactly that instead of failing quietly.

**Everything local, with Docker** (the Supabase CLI runs the whole stack — database, auth,
storage, functions, studio), if that is the machine you are on:

```bash
npx supabase start          # pulls images, starts Postgres on :54322
npm run seed                # regenerates supabase/seed.sql from the catalogue
npx supabase db reset       # migrations + seed, in order
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

An empty project behaves the same way: if the database answers with no nasheeds, the
bundled catalogue stays on screen rather than an empty room with a working backend, and the
staff room says which catalogue you are looking at. Seed it and the database takes over.

No credentials, no problem. The app boots into **demo mode**: the bundled catalogue is the
catalogue, the engine sings it, the lyrics still sync word by word, and every account-gated
action explains that it needs a project rather than failing mysteriously. The seeded notes
under each nasheed are generated, and the interface says so where it shows them.

---

## How the sound is made

```
track data  ──►  song.ts (composer)  ──►  Song { notes[], duff[], lines[] }
                                            │            │
                                            ▼            ▼
                                     audio/engine.ts   Lyrics.tsx
                                     (Web Audio)       (karaoke timings)
```

`src/lib/song.ts` is the single source of truth. It reads a nasheed's bpm, root, maqām,
motif bank and lyric lines, syllabifies every line, and walks a clock forward — emitting
**note events** for the synth *and* **word timings** for the lyric view in the same pass.
That is why the lyrics are frame-accurate: they are not aligned to audio afterwards, they
are the audio's own schedule. An uploaded recording keeps the same guarantee by storing the
timings it was recorded with.

- **Voices.** Each syllable gets a vowel (extracted by the syllabifier) and three slightly
  detuned saw oscillators, one per formant resonator: `a 760/1200/2600`, `e 520/1820/2500`,
  `i 300/2200/3000`, `o 520/900/2450`, `u 330/860/2300`, plus a closed-lip `m 260/900/1900`
  for humming. Lead, harmony and hum are separate buses with their own gains and sends.
- **Maqāmāt.** Ten scales with real quarter tones — Rāst `[0, 2, 3.5, 5, 7, 9, 10.5]`,
  Bayātī, Ḥijāz, Nahāwand, Kurd, ʿAjam, Ṣabā, Nikrīz, Ḥijāzkār, ʿUsshāq. Frequency is
  `root × 2^(degree/12)`, so a 3.5 step is an actual neutral third, not a detuned major.
- **Duff.** A synthesized frame drum (membrane sine drop + noise slap + rim), patterned per
  nasheed and always toggleable — plenty of listeners want vocals only, and the app treats
  that as a first-class preference rather than a mix setting.
- **Space.** The reverb is a convolution of a generated impulse response (decaying noise,
  per-preset length and decay). You pick the room — Studio 0.5s, Room 1.5s, Hall 3.1s,
  Masjid 4.6s — and the choice is persisted and applied on boot.
- **Recording.** The engine can render a nasheed into a buffer, which is what the studio
  turns into an uploaded file: the same graph, tapped after the compressor, with the reverb
  send included so a published recording sounds like the room it was previewed in.
- **Scheduler.** A 25 ms timer walks a rolling horizon 0.55 s ahead of the audio clock,
  which keeps note placement sample-accurate while staying cheap on the main thread. Seek,
  pause and stop rebuild the graph from the scheduler position rather than fighting it.

Nasheeds repeat, so songs are sung in **passes**: the text returns a step higher, then
settles home. The lyric view labels each repetition instead of pretending the words
appeared twice by accident.

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
  seed.sql     the catalogue as rows — generated, idempotent, committed on purpose
  setup.sql    the four migrations + the seed, in one file for the SQL editor
  config.toml  what `supabase start`, `db push` and `functions deploy` read
shared/
  types.ts     the wire contract — imported by the browser, by Deno and by the seed script
  fixtures/    publish-cases.json — the one contract both publish validators answer to
src/
  lib/         composer, maqām theory, syllabifier, prng, formatting
    api.ts       the only file that talks to Supabase
    supabase.ts  client, storage paths, function invocation
    wire.ts      database rows → app models
    beacon.ts    the play beacon: what counts as a listen, and when it is reported
    boot.ts      catalogue → session → library, once, without blocking first paint
    audio/       Web Audio engine (voices, duff, reverb, scheduler, recording)
    art/         procedural geometric patterns
    nur.ts       the curator: taste vectors, seeded mixes, reasons
  data/        types.ts, tracks.ts (24 nasheeds), catalog.ts (publishers, sets, moods, search)
  store/       player.ts (transport + queue), library.ts (loved, sets, history, settings),
               session.ts (auth), community.ts (the thread under a nasheed),
               studio.ts (drafts, attachments, publishing), ui.ts — zustand
  components/  layout, player (lyrics, visualizer, transport, immersive), track, collection,
               auth, art, ui primitives, tasbīḥ, Nūr panel, command palette, shortcuts
  pages/       Home, Search, Library, Queue, About, Collection, Playlist, Artist, Track,
               Studio, Profile, Admin, 404
scripts/
  setup.mjs                   `npm run setup` — builds a real Supabase project, then verifies it
  sql-bundle.mjs              migrations + seed → supabase/setup.sql
  pg-test.mjs                 the database suite: real Postgres in WebAssembly
  contract.ts                 the browser's publish validator, against the shared contract
  smoke.tsx                   headless suite (jsdom + fake AudioContext)
  export-supabase-seed.ts     catalogue → supabase/seed.sql
```

Stack: Vite 7 · React 19 · TypeScript (strict) · Tailwind CSS v4 · react-router v7 ·
zustand 5 · supabase-js 2 · Supabase (Postgres, Auth, Storage, Edge Functions).

Two projects are typechecked: `tsconfig.json` for the app (`strict`, `noUnusedLocals`,
`noUnusedParameters`) and `tsconfig.scripts.json`, which adds Node types so the generator and
the suite are checked too. `npm run typecheck` runs both; `npm run build` refuses to bundle
unless they pass. The Edge Functions are Deno, checked with `npm run functions:check`.

`npm run sql:test` runs the four migrations, the seed and Row Level Security against a
**real Postgres** — [PGlite](https://pglite.dev), Postgres compiled to WebAssembly, so there
is no Docker and no server, just the same planner, triggers and policies. It shims the
three things PGlite is not Supabase for (`auth.users` + `auth.uid()`/`auth.jwt()`/`auth.role()`
reading the same request GUCs, `storage.buckets`/`storage.objects`, and the anon /
authenticated / service_role roles), then signs up accounts, plays nasheeds, loves and
notes and reports them, publishes one straight through PostgREST, and asserts the wire
shape the client reads: every key of `catalog_payload()`, `trending()`, `daily_curve()`,
`song_stats()`, `my_history()`, `my_bootstrap()` and `admin_summary()`. It is 115 checks,
the last of them being the whole bundle applied a second time, because that is what the
setup file promises. It is not a formality — it found four things that would have shipped
broken:

Publishing has two validators, and a pair of hand-written mirrors is a pair that drifts, so
`npm run contract:test` holds both to `shared/fixtures/publish-cases.json`: `scripts/contract.ts`
reads it from the browser side (`songRowFromInput` / `songFromRow`, bundled by esbuild) and
`supabase/functions/_shared/contract_test.ts` reads it from the Deno side (`deno test`), each
asserting the same 15 accepted rows, the same refusals with the same status and field, and the
same stored-row → model mapping. `pg-test.mjs` closes the loop by inserting all 15 rows into a
real `public.songs` **as a listener**, which proves they satisfy the CHECK constraints and that
the column grants cover exactly what a publisher needs. `npm run verify` runs the lot.

- the BEFORE-UPDATE guards were freezing the counters the AFTER triggers maintain, so
  `plays`, `likes`, `notes` and `amens` never moved (a guard cannot tell a client from a
  security-definer trigger; column privileges can, and now do that job instead)
- the same guard was putting the first account's `role = 'staff'` straight back, so nobody
  would ever have reached the staff room
- three reports hid a note at **two**, because the auto-hide re-counted a counter the
  statement above it had already incremented
- `my_history()` ordered by a column that only exists in its camelCase alias, so the
  "recently played" rail would have thrown on every call

`npm run smoke` bundles the suite with esbuild and runs it under Node against a fake
`AudioContext`. It validates catalogue integrity (no orphan nasheeds or dangling publishers),
every generated song (finite frequencies, monotonic word timings, duff inside the song
bounds, durations between 40s and 5m), maqām arithmetic including quarter tones, the
syllabifier across Arabic/transliteration/English, search, Nūr's determinism, the audio
engine lifecycle, every route, the lyric view (line count, karaoke spans, repetition labels,
rail seeking), and the account gate: with nobody signed in, loving a nasheed and building a
set must be refused, must open the sign-in sheet, and must write nothing — while the
tasbīḥ, the preferences and the local history mirror still survive a reload, keys an older
save never wrote fall back to their defaults, and a stale id degrades quietly instead of
breaking the library page.
The audio checks are white-box: the fake context keeps every node it hands out, so the
suite asserts that voices really are sawtooth through three band-passes at the vowel
table's frequencies, that changing space swaps in a longer impulse response, that muting
the duff silences exactly one bus and leaves the voices alone, and that an out-of-range
volume is clamped onto the master.
Current run: **5,810 notes and 2,363 drum hits scheduled, every audio node inspected, 0 failures.**

---

## Content notes

Read this before you reuse anything here.

- **The synthesized audio is a demo, not a performance.** No human voice is in the bundled
  catalogue. Recordings uploaded through the studio are real, and belong to whoever uploaded
  them.
- **The publishers in the catalogue are fictional.** Real people are not credited with
  recordings that don't exist. The About page says so plainly, and the seeded notes under
  each nasheed are labeled as generated where they are shown.
- **The texts are real where they are marked real.** Well-known public-domain devotional
  lines are used (Ṭalaʿa al-Badru, Yā Nabiyya Salām ʿAlayka, an excerpt of al-Burda,
  al-Ḥuṣnī's dhikr formulas). Qurʾānic quotations are exact, attributed to their sūra and
  verse, and flagged in the lyric view.
- **Nothing depicts the Prophet ﷺ**, and honorifics are used wherever he is mentioned.
- The duff toggle exists because reasonable people disagree about instruments; the app takes
  no side and simply lets you choose vocals only.

## Not done / next

- Playlists are private. Making one public is a `select` policy on `playlists` and a share
  route — the table already carries everything a public page would need.
- Search is `ilike` plus a trigram index. Postgres full-text with an Arabic-aware
  configuration would be better, and would still cost nothing to run.
- Nūr's taste vectors are seeded heuristics over your history and loves, not a model. They
  run on-device, on data you already have, and every pick comes with its reason.
- Realtime is enabled for notes, amens and nasheed counters but the client does not
  subscribe yet — a thread updates when you open it, not while you watch it.
- The only external requests are to your Supabase project and the Google Fonts stylesheet in
  `index.html` (Marcellus, Plus Jakarta Sans, Amiri). Every family has a local fallback, and
  there is no telemetry of any kind.
