# Coolnasheed — vocals of light

A streaming client for nasheeds, built like Spotify or SoundCloud but shaped around
what nasheeds actually are: devotional poetry, a maqām, a voice, and a frame drum.

**Everything you hear is synthesized in your browser.** There are no audio files in this
repository — no samples, no recordings, no CDN. Each track is a small composition
(maqām, tempo, motif bank, lyric lines) and a Web Audio engine performs it live:
formant-filtered voices sing the syllables, a duff keeps time, and a generated
convolution reverb puts it all in a courtyard. Because the same data produces both the
notes *and* the lyric timings, the words cannot drift from the voice.

```
npm install
npm run dev        # http://localhost:5173
npm run smoke      # headless test suite — no browser needed
```

---

## What's in it

| | |
|---|---|
| **Catalogue** | 24 nasheeds, 8 reciters, 9 collections, 8 moods, 10 maqāmāt |
| **Synced lyrics** | per-word karaoke fill, three scripts (transliteration / العربية / English), line rail, translations, source notes for Qurʾān and public-domain lines |
| **Immersive player** | full-screen: procedural artwork, live visualizer, lyrics / queue / translation tabs |
| **Nūr** | an on-device curator that builds mixes and explains every pick — *"Stays in Ḥijāz — the mode you keep returning to, 2.4 points of it."* |
| **Library** | loved nasheeds, your own playlists, play history, lyric-script and duff preferences |
| **Tasbīḥ** | a dhikr counter in the sidebar — six phrases with 33 / 100 targets, a vibration pulse when you land on the target |
| **Search** | titles, lyric text, reciters, maqāmāt, tags; ⌘K command palette |
| **Themes** | *night garden* (default) and *dawn*, both fully tokenized |

Keyboard: `Space` play/pause · `N`/`B` next/previous · `←`/`→` seek · `I` immersive ·
`L` love · `D` duff on/off (vocals only) · `M` mute · `⌘K` palette · `/` search ·
`G` ask Nūr for a mix · `?` all shortcuts.

---

## How the sound is made

```
track data  ──►  song.ts (composer)  ──►  Song { notes[], duff[], lines[] }
                                            │            │
                                            ▼            ▼
                                     audio/engine.ts   Lyrics.tsx
                                     (Web Audio)       (karaoke timings)
```

`src/lib/song.ts` is the single source of truth. It reads a track's bpm, root, maqām,
motif bank and lyric lines, syllabifies every line, and walks a clock forward — emitting
**note events** for the synth *and* **word timings** for the lyric view in the same pass.
That is why the lyrics are frame-accurate: they are not aligned to audio afterwards, they
are the audio's own schedule.

- **Voices.** Each syllable gets a vowel (extracted by the syllabifier) and a saw oscillator
  pushed through three formant band-passes (`a: 700/1220/2600`, `i: 270/2290/3010`, …) with
  a soft attack and a breath noise layer. Lead, harmony and hum drone are separate buses.
- **Maqāmāt.** Ten scales with real quarter tones — Rāst `[0, 2, 3.5, 5, 7, 9, 10.5]`,
  Bayātī, Ḥijāz, Nahāwand, Kurd, ʿAjam, Sabā, Nikrīz, Ḥijāzkār, ʿUsshāq. Frequency is
  `root × 2^(degree/12)`, so a 3.5 step is an actual neutral third, not a detuned major.
- **Duff.** A synthesized frame drum (membrane sine drop + noise slap + rim), patterned per
  track and always toggleable — plenty of listeners want vocals only, and the app treats
  that as a first-class preference rather than a mix setting.
- **Space.** An impulse response is generated from decaying noise and used as a convolution
  reverb; wet/dry follows the track's mood.
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
pattern from the track id and draws Islamic geometry as SVG — star rosettes, girih strapwork,
mashrabiya arcs, zellige tiling — which `PatternArt` renders at any size. No two tracks look
alike, and the same track always looks the same.

---

## Layout

```
src/
  lib/         composer, maqām theory, syllabifier, prng, formatting
    audio/       Web Audio engine (voices, duff, reverb, scheduler)
    art/         procedural geometric patterns
    nur.ts       the curator: taste vectors, seeded mixes, reasons
  data/        types.ts, tracks.ts (24 nasheeds), catalog.ts (reciters, sets, moods, search)
  store/       player.ts (transport + queue), library.ts (loved, playlists, history, settings),
               ui.ts (theme, overlays) — zustand, persisted to localStorage
  components/  layout, player (lyrics, visualizer, transport, immersive), track, collection,
               art, ui primitives, tasbīḥ, Nūr panel, command palette, shortcuts
  pages/       Home, Search, Library, Queue, About, Collection, Playlist, Artist, Track, 404
scripts/
  smoke.tsx    headless test suite (jsdom + fake AudioContext)
```

Stack: Vite 7 · React 19 · TypeScript (strict) · Tailwind CSS v4 · react-router v7 · zustand 5.

`npm run smoke` bundles the suite with esbuild and runs it under Node against a fake
`AudioContext`. It validates catalogue integrity (no orphan tracks or dangling reciters),
every generated song (finite frequencies, monotonic word timings, duff inside the song
bounds, durations between 40s and 5m), maqām arithmetic including quarter tones, the
syllabifier across Arabic/transliteration/English, search, Nūr's determinism, the audio
engine lifecycle, all 18 routes, the lyric view (line count, karaoke spans, repetition
labels, rail seeking), and UI interactions such as loving a track and counting tasbīḥ.
Current run: **5,810 notes, 2,363 drum hits, 377 audio nodes, 0 failures.**

---

## Content notes

Read this before you reuse anything here.

- **The audio is a synthesized demo, not a performance.** No human voice is in this app.
- **The reciters are fictional.** Real people are not credited with recordings that don't
  exist. The About page says so plainly.
- **The texts are real where they are marked real.** Well-known public-domain devotional
  lines are used (Ṭalaʿa al-Badru, Yā Nabiyya Salām ʿAlayka, an excerpt of al-Burda,
  al-Ḥuṣnī's dhikr formulas). Qurʾānic quotations are exact, attributed to their sūra and
  verse, and flagged in the lyric view.
- **Nothing depicts the Prophet ﷺ**, and honorifics are used wherever he is mentioned.
- The duff toggle exists because reasonable people disagree about instruments; the app takes
  no side and simply lets you choose vocals only.

## Not done / next

- No real audio backend — swapping the engine for streamed files means changing
  `loadAndPlay` in `src/store/player.ts` and nothing else, since timings already come from
  data rather than analysis.
- Nūr's taste vectors are seeded heuristics, not a model. The app makes no network calls of
  its own — no API, no telemetry, no audio CDN. The only external request is the Google
  Fonts stylesheet in `index.html` (Marcellus, Plus Jakarta Sans, Amiri), and every family
  has a local fallback.
