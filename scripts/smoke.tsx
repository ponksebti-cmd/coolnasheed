/**
 * Headless smoke test.
 *
 * Bundled with esbuild and run under jsdom, so the parts of the app that are worth
 * checking without a browser — the row mappers, the catalogue registry, the media
 * element wrapper, the player store, the gate on writing, the lyric view and every
 * route — are exercised for real:
 *
 *   npm run smoke
 *
 * There is no audio engine to fake any more. A nasheed is an mp3 on a CDN, so what
 * this file fakes is `<audio>`: one element, whose events it fires by hand, and then
 * it checks that the store, the beacon and the pages all believe it.
 *
 * The network is absent on purpose. Every call that would need the backend must fail
 * with a sentence a person could act on, and no page may invent a catalogue to make up
 * for it — which is the whole point of the rewrite this test is here to hold in place.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

/* ------------------------------------------------------------------ report */

const failures: string[] = [];
const notes: string[] = [];
let assertions = 0;

function assert(name: string, condition: boolean, detail = "") {
  assertions += 1;
  if (condition) notes.push(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else failures.push(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function section(title: string) {
  notes.push(`\n${title}`);
}

/* -------------------------------------------------------------- jsdom host */

const quietConsole = new VirtualConsole();
quietConsole.on("jsdomError", () => {});
quietConsole.on("error", () => {});

const dom = new JSDOM(
  `<!doctype html><html><head></head><body><div id="root"></div></body></html>`,
  {
    url: "http://localhost:5173/",
    pretendToBeVisual: true,
    virtualConsole: quietConsole,
  },
);

const w = dom.window as unknown as Record<string, unknown> & typeof dom.window;

/** Node 22 makes some globals getter-only, so define rather than assign. */
function setGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

/* ------------------------------------------------------------------- audio */

/** The element the app is allowed to play: one mp3, and nothing generated. */
class FakeAudio extends w.EventTarget {
  src = "";
  currentTime = 0;
  duration = Number.NaN;
  volume = 1;
  muted = false;
  paused = true;
  ended = false;
  readyState = 0;
  crossOrigin: string | null = null;
  preload = "none";
  error: { code: number } | null = null;
  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;

  constructor() {
    super();
    audioElements.push(this);
  }

  private emit(type: string) {
    this.dispatchEvent(new w.Event(type));
  }

  load() {
    this.loadCalls += 1;
    this.readyState = 1;
    this.duration = 192;
    queueMicrotask(() => this.emit("loadedmetadata"));
  }

  async play() {
    this.playCalls += 1;
    this.paused = false;
    this.readyState = 4;
    this.emit("play");
    this.emit("playing");
  }

  pause() {
    this.pauseCalls += 1;
    this.paused = true;
    this.emit("pause");
  }

  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }

  /** Test-only: pretend the CDN handed back a bad file. */
  fail(code = 4) {
    this.error = { code };
    this.readyState = 0;
    this.paused = true;
    this.emit("error");
  }

  /** Test-only: playback reaches a new position. */
  advance(to: number) {
    this.currentTime = to;
    this.emit("timeupdate");
  }
}

const audioElements: FakeAudio[] = [];

setGlobal("window", w);
setGlobal("document", w.document);
setGlobal("navigator", w.navigator);
setGlobal("location", w.location);
setGlobal("history", w.history);
setGlobal("localStorage", w.localStorage);
setGlobal("CustomEvent", w.CustomEvent);
setGlobal("Event", w.Event);
setGlobal("MouseEvent", w.MouseEvent);
setGlobal("KeyboardEvent", w.KeyboardEvent);
setGlobal("HTMLElement", w.HTMLElement);
setGlobal("Element", w.Element);
setGlobal("Node", w.Node);
setGlobal("getComputedStyle", w.getComputedStyle.bind(w));
setGlobal("Audio", FakeAudio);
setGlobal("MediaError", {
  MEDIA_ERR_ABORTED: 1,
  MEDIA_ERR_NETWORK: 2,
  MEDIA_ERR_DECODE: 3,
  MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
});
setGlobal(
  "requestAnimationFrame",
  (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 16) as unknown as number,
);
setGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
(setGlobal as unknown as (n: string, v: unknown) => void)(
  "IntersectionObserver",
  class {
    constructor(
      private cb: (
        entries: { isIntersecting: boolean; target: Element }[],
      ) => void,
    ) {}
    observe(target: Element) {
      this.cb([{ isIntersecting: true, target }]);
    }
    disconnect() {}
    unobserve() {}
  },
);
setGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
);
/* jsdom's `window` is not Node's global, and the DOM matchers live on the former, so
   a browser API has to go on both to satisfy code that reaches for either. */
const matchMediaStub = (query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
  dispatchEvent: () => false,
});
setGlobal("matchMedia", matchMediaStub);
w.matchMedia = matchMediaStub as unknown as typeof w.matchMedia;
setGlobal("IS_REACT_ACT_ENVIRONMENT", true);

/* Points the client at a project that does not exist: configured, so every network path
   really runs, and unreachable, so every failure has to be reported in words. */
setGlobal("__COOLNASHEED_ENV__", {
  VITE_SUPABASE_URL: "https://smoke.supabase.co",
  VITE_SUPABASE_ANON_KEY: "smoke-anon-key-0000000000000000000000",
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ fixture */

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "shared/fixtures/publish-cases.json"),
    "utf8",
  ),
) as {
  owner: string;
  songRows: {
    name: string;
    ownerHandle: string | null;
    row: Record<string, unknown>;
  }[];
};

/** The catalogue the payload would carry, described the way the server describes it. */
const OWNER = fixture.owner;
const SECOND = "11111111-2222-3333-4444-555555555555";

const songRow = (patch: Record<string, unknown>) => ({
  id: "sng_smoke_0001",
  owner_id: OWNER,
  title: "Ṭalaʿa al-Badru ʿAlaynā",
  title_ar: "طلع البدر علينا",
  note: "The oldest welcome song we have.",
  tags: ["traditional", "madinah"],
  lines: [
    {
      tr: "ṭalaʿa al-badru ʿalaynā",
      ar: "طلع البدر علينا",
      en: "the full moon rose over us",
      t: 0,
    },
    {
      tr: "min thaniyyāti al-wadāʿ",
      ar: "من ثنيات الوداع",
      en: "from the valley of farewell",
      t: 6,
    },
  ],
  audio_path: `${OWNER}/talaa.mp3`,
  audio_mime: "audio/mpeg",
  audio_bytes: 5120000,
  duration_ms: 192000,
  artwork_path: null,
  status: "live",
  published_at: "2026-09-15T09:30:00.000Z",
  plays: 12,
  likes: 3,
  notes: 1,
  ...patch,
});

const ROWS = [
  songRow({}),
  songRow({
    id: "sng_smoke_0002",
    title: "Yā Nabiyy Salām",
    tags: ["salawat"],
    lines: [],
    plays: 4,
    likes: 1,
    notes: 0,
    audio_path: `${OWNER}/salam.mp3`,
  }),
  songRow({
    id: "sng_smoke_0003",
    title: "Subḥān Allāh",
    tags: ["dhikr"],
    lines: [],
    plays: 40,
    likes: 9,
    notes: 2,
    audio_path: `${OWNER}/subhan.mp3`,
  }),
];

/* ------------------------------------------------------------------- tests */

async function main() {
  const consoleErrors: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    consoleErrors.push(msg);
    if (!msg.includes("act(") && !msg.includes("ReactDOMTestUtils"))
      realError(...args);
  };

  /* ----------------------------------------------------------- configuration */

  section("Configuration");
  const supabase = await import("../src/lib/supabase");
  const errors = await import("../src/lib/errors");
  const api = (await import("../src/lib/api")).api;
  /* this run is wired to a project that does not exist, which is the interesting case:
     the client is configured, so it really does try, and it has to fail in words */
  assert(
    "the harness points at a project",
    supabase.hasSupabase === true,
    supabase.backendLabel(),
  );
  assert(
    "and the project ref is read from the url",
    supabase.projectRef === "smoke",
    supabase.projectRef,
  );
  assert(
    "a stored path becomes a public cdn url",
    supabase.audioUrl(`${OWNER}/talaa.mp3`) ===
      `https://smoke.supabase.co/storage/v1/object/public/nasheed-audio/${OWNER}/talaa.mp3`,
    String(supabase.audioUrl(`${OWNER}/talaa.mp3`)),
  );

  let catalogError: unknown = null;
  try {
    await api.catalog();
  } catch (err) {
    catalogError = err;
  }
  assert(
    "asking for the catalogue from an unreachable project fails with a sentence, not a stack",
    catalogError instanceof errors.ApiError,
    catalogError instanceof Error
      ? catalogError.message.slice(0, 90)
      : String(catalogError),
  );

  /* ----------------------------------------------------------- row mappers */

  section("Rows in, models out");
  const wire = await import("../src/lib/wire");
  for (const rowCase of fixture.songRows) {
    const song = wire.songFromRow({
      ...rowCase.row,
      ownerHandle: rowCase.ownerHandle,
    } as never);
    assert(
      `the fixture's "${rowCase.name}" maps`,
      typeof song.id === "string" && song.audioPath.length > 0,
      song.title,
    );
  }
  const live = wire.songFromRow(ROWS[0] as never);
  assert(
    "timings survive the mapping",
    live.lines[1]?.t === 6,
    JSON.stringify(live.lines[1] ?? null),
  );
  assert(
    "counters are numbers, not strings",
    live.plays === 12 && live.likes === 3 && live.notes === 1,
  );
  assert(
    "a null duration stays null rather than becoming a guess",
    wire.songFromRow(songRow({ duration_ms: null }) as never).durationMs ===
      null,
  );
  assert(
    "a row with no recording is not playable",
    wire.playableRow(songRow({ audio_path: null }) as never) === false,
  );
  assert(
    "and one with a recording is",
    wire.playableRow(ROWS[0] as never) === true,
  );

  const audioUrl = wire.songAudioUrl(live);
  const artUrl = wire.songArtworkUrl(live);
  assert(
    "an audio path becomes a url only when the project knows its host",
    audioUrl === null || audioUrl.includes("talaa.mp3"),
    String(audioUrl),
  );
  assert(
    "artwork that is not there stays null",
    artUrl === null,
    String(artUrl),
  );

  /* ------------------------------------------------- the publish mirror */

  section("The browser's publish validator");
  const row = wire.songRowFromInput(
    { title: "A test", audioPath: `${OWNER}/test.mp3` } as never,
    OWNER,
  );
  assert(
    "a minimal payload becomes a row with an mp3 in it",
    row.audio_path === `${OWNER}/test.mp3` &&
      row.note === "" &&
      !("accent" in row) &&
      !("year" in row),
  );
  let refused = "";
  try {
    wire.songRowFromInput(
      { title: "A test", audioPath: `${SECOND}/test.mp3` } as never,
      OWNER,
    );
  } catch (err) {
    refused = err instanceof Error ? err.message : String(err);
  }
  assert(
    "and somebody else's file is refused, by name",
    refused.includes("your own folder"),
    refused,
  );
  let composition = "";
  try {
    wire.songRowFromInput(
      { title: "A test", audioPath: `${OWNER}/test.mp3`, bpm: 84 } as never,
      OWNER,
    );
  } catch (err) {
    composition = err instanceof Error ? err.message : String(err);
  }
  assert(
    "a composition parameter is refused, not quietly dropped",
    composition.includes("bpm"),
    composition,
  );

  /* ------------------------------------------------------------ catalogue */

  section("The catalogue registry");
  const catalog = await import("../src/data/catalog");
  assert(
    "it starts empty — there is no bundled catalogue",
    catalog.TRACKS.length === 0 && catalog.ARTISTS.length === 0,
  );

  let notified = 0;
  const unsubscribe = catalog.subscribeCatalog(() => {
    notified += 1;
  });

  const payload = {
    songs: ROWS.map((r) => wire.songFromRow(r as never)),
    artists: [
      {
        id: "hafsa.noor",
        profileId: OWNER,
        handle: "hafsa.noor",
        name: "Hafsa Noor",
        nameAr: null,
        role: "Publisher",
        origin: "—",
        bio: "",
        accent: "gold" as const,
        verified: false,
        kind: "artist" as const,
        avatarPath: null,
        songs: 3,
        followers: 2,
      },
      {
        id: "maryam.q",
        profileId: SECOND,
        handle: "maryam.q",
        name: "Maryam Q.",
        nameAr: null,
        role: "Publisher",
        origin: "Algiers",
        bio: "",
        accent: "jade" as const,
        verified: false,
        kind: "artist" as const,
        avatarPath: null,
        songs: 0,
        followers: 0,
      },
    ],
    collections: [
      {
        id: "col_1",
        kind: "mukhtarat" as const,
        title: "Ramadan nights",
        titleAr: null,
        curator: "CoolNasheed",
        blurb: "Sung after tarāwīḥ.",
        accent: "turq" as const,
        tags: ["ramadan"],
        year: 2026,
        songIds: [ROWS[0].id as string, ROWS[2].id as string],
      },
    ],
    tags: [
      { tag: "traditional", count: 1 },
      { tag: "dhikr", count: 1 },
    ],
    generatedAt: Date.now(),
  };
  const hydrated = catalog.hydrateCatalog(payload);
  assert(
    `hydrating fills the registry in place (${hydrated} nasheeds)`,
    catalog.TRACKS.length === 3,
  );
  assert(
    "and tells whoever is listening",
    notified === 1,
    `${notified} notification`,
  );
  assert(
    "lookups resolve",
    catalog.getTrack(ROWS[0].id as string)?.title === "Ṭalaʿa al-Badru ʿAlaynā",
  );
  assert(
    "a set walks its own tracks",
    catalog.tracksOf(payload.collections[0]!).length === 2,
  );
  assert(
    "an unknown id is undefined, not a guess",
    catalog.getTrack("sng_nope") === undefined,
  );
  assert(
    "a nasheed's publisher resolves",
    catalog.artistOf(catalog.TRACKS[0]!).name === "Hafsa Noor",
  );
  assert(
    "a set is found from a nasheed",
    catalog.collectionsOf(catalog.TRACKS[0]!).length === 1,
  );
  assert("tags are counted from the payload", catalog.tagCounts().length === 2);
  assert("the newest shelf is first", catalog.latestSongs(10).length === 3);
  assert(
    "the popular shelf is ordered by plays",
    catalog.popularSongs(1)[0]!.title === "Subḥān Allāh",
  );
  assert(
    "search finds a nasheed by a word in its lyrics",
    catalog.searchTracks("farewell").some((t) => t.id === ROWS[0].id),
  );
  assert(
    "search finds a publisher",
    catalog.searchArtists("hafsa").length === 1,
  );
  assert(
    "searching for nothing finds nothing",
    catalog.searchTracks("   ").length === 0,
  );

  const shuffleA = (await import("../src/lib/math")).seededShuffle(
    [1, 2, 3, 4, 5, 6, 7, 8],
    "smoke",
  );
  const shuffleB = (await import("../src/lib/math")).seededShuffle(
    [1, 2, 3, 4, 5, 6, 7, 8],
    "smoke",
  );
  assert(
    "a seeded shuffle is a shuffle, and it is stable",
    JSON.stringify(shuffleA) === JSON.stringify(shuffleB) &&
      shuffleA.length === 8,
    shuffleA.join(""),
  );

  /* ------------------------------------------------------ the media element */

  section("The player: one <audio> element, one mp3");
  const { player } = await import("../src/lib/audio/player");
  const { usePlayer } = await import("../src/store/player");
  const { DEFAULT_CONTEXT } = await import("../src/store/player");

  const ids = ROWS.map((r) => r.id as string);
  act(() =>
    usePlayer
      .getState()
      .playIds(ids, 0, { ...DEFAULT_CONTEXT, label: "Smoke" }),
  );
  await sleep(30);

  const store = usePlayer.getState();
  assert(
    "playIds loads the element and starts it",
    store.trackId === ROWS[0].id && store.queue.length === 3,
    `track=${store.trackId} queue=${store.queue.length}`,
  );
  assert(
    "the element was given a real url",
    audioElements[0]?.src.length
      ? audioElements[0]!.src.includes("talaa.mp3")
      : false,
    audioElements[0]?.src ?? "no element",
  );
  assert(
    "and the element was asked to play",
    audioElements.length === 1 && audioElements[0]!.playCalls >= 1,
    `${audioElements[0]?.playCalls ?? 0} play() calls`,
  );
  assert(
    "exactly one element exists, reused for every track",
    audioElements.length === 1,
    `${audioElements.length} created`,
  );

  audioElements[0]!.advance(7.5);
  await sleep(10);
  assert(
    "time comes from the element, not a timer",
    Math.abs(usePlayer.getState().time - 7.5) < 0.01,
    `${usePlayer.getState().time}s`,
  );

  act(() => usePlayer.getState().seek(90));
  assert(
    "seeking moves the element",
    Math.abs(audioElements[0]!.currentTime - 90) < 0.01,
    `${audioElements[0]!.currentTime}s`,
  );

  act(() => usePlayer.getState().next());
  await sleep(30);
  assert(
    "next walks the queue",
    usePlayer.getState().trackId === ROWS[1].id,
    String(usePlayer.getState().trackId),
  );
  act(() => usePlayer.getState().prev());
  await sleep(20);
  assert(
    "and prev walks it back",
    usePlayer.getState().trackId === ROWS[0].id,
    String(usePlayer.getState().trackId),
  );

  act(() => usePlayer.getState().toggle());
  assert(
    "pause stops the element",
    audioElements[0]!.paused === true && usePlayer.getState().playing === false,
  );
  act(() => usePlayer.getState().toggle());
  await sleep(20);
  assert("and play starts it again", usePlayer.getState().playing === true);

  act(() => usePlayer.getState().setVolume(0.3));
  act(() => usePlayer.getState().toggleMute());
  assert(
    "mute is a real mute, and the volume is remembered",
    audioElements[0]!.volume === 0 && player.volumeLevel === 0.3,
  );
  act(() => usePlayer.getState().toggleMute());
  assert(
    "unmuting restores the volume",
    Math.abs(audioElements[0]!.volume - 0.3) < 0.001,
  );

  act(() => usePlayer.getState().addToQueue(ROWS[2].id as string));
  assert(
    "a nasheed can be queued",
    usePlayer.getState().queue.includes(ROWS[2].id as string),
  );
  act(() => usePlayer.getState().clearQueue());
  assert(
    "and the queue can be emptied",
    usePlayer.getState().queue.length === 0 &&
      usePlayer.getState().trackId === null,
  );

  /* --------------------------------------------------------- error handling */

  section("When the recording will not play");
  act(() => usePlayer.getState().playIds(ids, 0, DEFAULT_CONTEXT));
  await sleep(30);
  const fatal = audioElements[0]!;
  fatal.fail(1); // MEDIA_ERR_ABORTED is our own stop, not an error worth showing
  await sleep(10);
  assert(
    "an aborted load is not reported as a failure",
    usePlayer.getState().error === null,
    String(usePlayer.getState().error),
  );

  /* a dropped connection is worth another go, from where it got to */
  const loadsBefore = fatal.loadCalls;
  fatal.fail(2);
  await sleep(120);
  assert(
    "a dropped connection is not given up on at once",
    usePlayer.getState().error === null,
    String(usePlayer.getState().error),
  );
  await sleep(900);
  assert(
    "and it is picked back up from where it stopped",
    fatal.loadCalls > loadsBefore,
    `${loadsBefore} → ${fatal.loadCalls}`,
  );

  /* a file that is not there will not be there in two seconds either */
  fatal.fail(4);
  await sleep(80);
  const message = usePlayer.getState().error ?? "";
  assert(
    "a missing file is reported at once, in words",
    message.includes("could not be played"),
    message,
  );
  act(() => usePlayer.getState().dismissError());
  assert(
    "and the message can be dismissed",
    usePlayer.getState().error === null,
  );

  /* ------------------------------------------------------------- the beacon */

  section("The play beacon");
  const beacon = await import("../src/lib/beacon");
  const sent: { songId: string; seconds: number; completed: boolean }[] = [];
  const realPlay = api.play;
  (api as unknown as { play: unknown }).play = async (input: {
    songId: string;
    seconds: number;
    completed: boolean;
  }) => {
    sent.push(input);
    return { ok: true, counted: input.seconds >= 15, plays: 1 };
  };

  beacon.beaconStart("sng_smoke_0001");
  beacon.beaconTick(1.5);
  beacon.beaconTick(60); // a backgrounded tab handing back a silly delta
  beacon.beaconFlush();
  await sleep(20);
  assert(
    "a skip under three seconds is dropped, not sent",
    sent.length === 0,
    JSON.stringify(sent),
  );

  beacon.beaconStart("sng_smoke_0001");
  beacon.beaconTick(4);
  beacon.beaconTick(4);
  beacon.beaconComplete();
  await sleep(20);
  assert(
    "a finished listen is one event, with its seconds",
    sent.length === 1 &&
      sent[0]!.completed === true &&
      Math.abs(sent[0]!.seconds - 8) < 0.001,
    JSON.stringify(sent),
  );
  assert("and nothing is left waiting", beacon.beaconIdle() === true);

  (api as unknown as { play: unknown }).play = realPlay;

  /* ------------------------------------------------------------------ gate */

  section("Writing needs an account; listening does not");
  const { useLibrary } = await import("../src/store/library");
  const { useUi } = await import("../src/store/ui");
  act(() => useUi.setState({ authOpen: false }));

  const refusedLike = useLibrary.getState().toggleLike(ROWS[0].id as string);
  assert(
    "loving a nasheed while signed out is refused",
    refusedLike === null,
    `returned ${String(refusedLike)}`,
  );
  assert(
    "and the sign-in sheet opens instead",
    useUi.getState().authOpen === true,
  );
  assert("nothing was written", useLibrary.getState().liked.length === 0);
  act(() => useUi.setState({ authOpen: false }));

  const count = useLibrary.getState().dhikrTick();
  assert("the dhikr counter counts", count === 1, `${count}`);
  useLibrary.getState().dhikrSelect("istighfar");
  useLibrary.getState().dhikrTick();
  useLibrary.getState().dhikrTick();
  assert(
    "each phrase keeps its own count",
    useLibrary.getState().dhikr.istighfar?.count === 2,
    JSON.stringify(useLibrary.getState().dhikr),
  );
  useLibrary.getState().dhikrReset("istighfar");
  assert(
    "and can be reset",
    useLibrary.getState().dhikr.istighfar?.count === 0,
  );

  assert(
    "settings have defaults even with no account",
    useLibrary.getState().settings.theme === "dawn" &&
      useLibrary.getState().settings.volume > 0,
  );

  /* ------------------------------------------------------------- lyrics view */

  section("The lyric view");
  const { Lyrics } = await import("../src/components/player/Lyrics");
  const host = w.document.createElement("div");
  w.document.body.appendChild(host);
  const lyricRoot = createRoot(host);
  const song = catalog.TRACKS[0]!;
  await act(async () => {
    lyricRoot.render(
      createElement(Lyrics, {
        song: song as never,
        variant: "immersive" as never,
      }),
    );
  });
  await sleep(60);
  const text = host.textContent ?? "";
  assert(
    "every line of the nasheed is rendered",
    text.includes("ṭalaʿa al-badru") && text.includes("min thaniyyāti"),
    "",
  );
  assert(
    "the script switcher is there",
    text.includes("Transliteration") || text.includes("العربية"),
    "",
  );
  await act(async () => {
    lyricRoot.unmount();
  });
  host.remove();

  /* A nasheed page has one lyric view and it sits at the top, beside the cover: it used
     to have two — a four-line teaser under a "the words" heading, and the real thing
     below it — which is one too many ways to read the same lines. */
  const trackPageSrc = readFileSync(join(process.cwd(), "src/pages/TrackPage.tsx"), "utf8");
  assert(
    "a nasheed page has one lyric view, beside the cover",
    !trackPageSrc.includes("LyricPreview") &&
      (trackPageSrc.match(/<Lyrics\b/g) ?? []).length === 1 &&
      trackPageSrc.indexOf('id="lyrics"') < trackPageSrc.indexOf('title="Notes"'),
    `${(trackPageSrc.match(/<Lyrics\b/g) ?? []).length} lyric views`,
  );

  /* ---------------------------------------------------- words over the cover */

  /* The lyric stage: the artwork turned into light with the line being sung in the
     middle of it. It is the one screen that is dark in both themes, so it carries
     `over-art`; and it is a viewer for the same timings the sheet uses. */
  section("The words over the cover");

  const { LyricStage } = await import("../src/components/player/LyricStage");
  /* the stage is a viewer onto the audio element, so there has to be one playing */
  act(() => usePlayer.getState().playTrack(catalog.TRACKS[0]!.id, { kind: "home", label: "Stage" }));
  await sleep(30);
  const stageHost = w.document.createElement("div");
  w.document.body.appendChild(stageHost);
  const stageRoot = createRoot(stageHost);
  let leftStage = 0;
  await act(async () => {
    stageRoot.render(
      createElement(LyricStage, {
        song: catalog.TRACKS[0]! as never,
        onClose: () => {
          leftStage += 1;
        },
      }),
    );
  });
  await sleep(60);
  const stageText = stageHost.textContent ?? "";
  assert(
    "the stage shows the words of the recording",
    stageText.includes("ṭalaʿa al-badru") && stageText.includes("min thaniyyāti"),
    stageText.slice(0, 120),
  );
  assert(
    "it is a room of its own, dark in both themes",
    stageHost.querySelector("section.over-art") !== null,
    String(stageHost.firstElementChild?.className ?? ""),
  );
  assert(
    "and the controls travel with it",
    stageText.includes("Transliteration") === false &&
      stageHost.querySelector("footer") !== null,
    "footer present",
  );

  /* a line you tap is a line the recording goes to */
  const lineButtons = Array.from(stageHost.querySelectorAll("button")).filter(
    (b) => (b.textContent ?? "").includes("min thaniyyāti"),
  );
  await act(async () => {
    lineButtons[0]?.click();
  });
  await sleep(20);
  assert(
    "tapping a line takes the recording there",
    Math.abs(audioElements[0]!.currentTime - 6) < 0.01,
    `${audioElements[0]!.currentTime}s`,
  );

  /* a tap on the room clears the chrome, and the tap that seeks does not */
  const words = stageHost.querySelector("section.over-art > div.relative.z-10") as HTMLElement | null;
  await act(async () => {
    words?.click();
  });
  await sleep(20);
  assert(
    "tapping the room hides the controls",
    stageHost.querySelector("footer")?.className.includes("opacity-0") === true,
    String(stageHost.querySelector("footer")?.className ?? ""),
  );
  await act(async () => {
    words?.click();
  });
  await sleep(20);
  assert(
    "and tapping it again brings them back",
    stageHost.querySelector("footer")?.className.includes("opacity-100") === true,
  );

  /* Escape is one step back, not two */
  await act(async () => {
    w.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  assert("Escape leaves the stage", leftStage === 1, `${leftStage} closes`);

  await act(async () => {
    stageRoot.unmount();
  });
  stageHost.remove();

  /* and the player offers the way in — from the header and from the cover itself */
  const immersiveSource = readFileSync(
    join(process.cwd(), "src/components/player/ImmersivePlayer.tsx"),
    "utf8",
  );
  assert(
    "the full-screen player mounts the stage and offers it twice over",
    immersiveSource.includes("<LyricStage") &&
      immersiveSource.includes("Show the lyrics over the cover") &&
      immersiveSource.includes("words over the cover"),
  );

  /* ------------------------------------------------------------- schema probe */

  section("Asking the database which version it is");

  const schemaLib = await import("../src/lib/schema");
  assert(
    "the client knows what it writes against",
    schemaLib.EXPECTED_SCHEMA_VERSION === "catalogue-window-1",
  );
  assert(
    "a database that is behind is not usable",
    schemaLib.isUsable({ state: "behind", version: "old", detail: "" }) ===
      false,
  );
  assert(
    "an unreachable one is not held against it",
    schemaLib.isUsable({ state: "unknown", detail: "" }) === true,
  );

  /* The real Supabase client is left in place and the network under it is stubbed, so
     what is exercised is the actual PostgREST call and its real error codes. */
  const realFetch = globalThis.fetch;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const missingTable = (table: string) =>
    json(
      {
        code: "PGRST205",
        message: `Could not find the table 'public.${table}' in the schema cache`,
        details: null,
        hint: null,
      },
      404,
    );

  const stubFetch = (handler: (url: string) => Response) => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: (input: RequestInfo | URL) =>
        Promise.resolve(handler(String(input))),
    });
  };
  const restoreFetch = () => {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: realFetch,
    });
    schemaLib.invalidateSchema();
  };

  stubFetch((url) =>
    url.includes("/rest/v1/app_schema")
      ? json([{ version: "catalogue-window-1" }])
      : json([]),
  );
  const fresh = await schemaLib.checkSchema(true);
  assert(
    "a matching version reads as ready",
    fresh.state === "ok",
    JSON.stringify(fresh),
  );

  stubFetch((url) =>
    url.includes("/rest/v1/app_schema")
      ? json([{ version: "vocals-of-light-3" }])
      : json([]),
  );
  const older = await schemaLib.checkSchema(true);
  assert(
    "an older version is reported as behind",
    older.state === "behind",
    JSON.stringify(older),
  );
  assert(
    "and the sentence names exactly what to run",
    (schemaLib.schemaProblem(older) ?? "").includes("npm run setup"),
    schemaLib.schemaProblem(older) ?? "",
  );

  stubFetch(() => json([]));
  const noVersion = await schemaLib.checkSchema(true);
  assert(
    "an empty version table is reported as behind",
    noVersion.state === "behind",
    JSON.stringify(noVersion),
  );

  stubFetch((url) =>
    missingTable(
      url.includes("studio_drafts")
        ? "studio_drafts"
        : url.includes("/rest/v1/songs")
          ? "songs"
          : "app_schema",
    ),
  );
  const noTables = await schemaLib.checkSchema(true);
  assert(
    "a project with no tables at all reads as missing",
    noTables.state === "missing",
    JSON.stringify(noTables),
  );
  assert(
    "and says so with the fix",
    (schemaLib.schemaProblem(noTables) ?? "").includes("no tables yet"),
    schemaLib.schemaProblem(noTables) ?? "",
  );

  /* The state a real project was in: tables that answer, just not the ones this build
     writes against. Telling somebody their project has no tables when it has a catalogue
     in it sends them to set up a project that is already set up. */
  stubFetch((url) =>
    url.includes("/rest/v1/app_schema") || url.includes("studio_drafts")
      ? missingTable(
          url.includes("studio_drafts") ? "studio_drafts" : "app_schema",
        )
      : json([]),
  );
  const preAudio = await schemaLib.checkSchema(true);
  assert(
    "a project with the older tables reads as behind, not as empty",
    preAudio.state === "behind",
    JSON.stringify(preAudio),
  );
  const preAudioSentence = schemaLib.schemaProblem(preAudio) ?? "";
  assert(
    "and its sentence does not claim there are no tables",
    preAudioSentence.includes("older version") &&
      !/no tables yet/.test(preAudioSentence),
    preAudioSentence,
  );

  stubFetch((url) =>
    url.includes("/rest/v1/app_schema") ? missingTable("app_schema") : json([]),
  );
  const stale = await schemaLib.checkSchema(true);
  assert(
    "the old tables without a version marker read as behind",
    stale.state === "behind",
    JSON.stringify(stale),
  );

  /* A dropped connection, not an unhappy project: supabase-js retries a 5xx itself for
     about seven seconds, and a test that waits for that is a test nobody runs. */
  stubFetch(() => {
    throw new TypeError("Network request failed");
  });
  const unreachable = await schemaLib.checkSchema(true);
  assert(
    "a failing project is not called a broken database",
    unreachable.state === "unknown",
    JSON.stringify(unreachable),
  );
  assert(
    "and it produces no alarming sentence",
    schemaLib.schemaProblem(unreachable) === null,
  );
  assert(
    "while an unknown schema never blocks the app",
    schemaLib.isUsable(unreachable) === true,
  );

  restoreFetch();

  /* ------------------------------------------------------------- draft saving */

  section("Saving the draft, and saying when it cannot");

  const apiModule0 = await import("../src/lib/api");
  const studio = await import("../src/store/studio");
  const apiObject = apiModule0.api;
  const realSaveDraft = apiObject.saveDraft;
  const session = await import("../src/store/session");

  /* Sign-in is the gate on every draft write, and the gate reads the store, so the store
     is what the test sets — no Supabase Auth involved. */
  const signedOutUser = session.useSession.getState().user;
  session.useSession.setState({
    user: {
      id: OWNER,
      handle: "hafsa.noor",
      name: "Hafsa Noor",
      role: "member",
    } as never,
    currentId: OWNER,
  });
  assert(
    "the harness can act as a signed-in publisher",
    session.isSignedIn() === true,
  );

  let saveCalls = 0;
  Object.defineProperty(apiObject, "saveDraft", {
    configurable: true,
    writable: true,
    value: async () => {
      saveCalls += 1;
    },
  });
  await studio.useStudio.getState().saveDraft();
  assert(
    "a save that works records the time and clears the complaint",
    saveCalls === 1 &&
      studio.useStudio.getState().savedAt > 0 &&
      studio.useStudio.getState().draftError === null,
    `calls=${saveCalls}`,
  );

  Object.defineProperty(apiObject, "saveDraft", {
    configurable: true,
    writable: true,
    value: async () => {
      throw new Error("permission denied for table studio_drafts");
    },
  });
  await studio.useStudio.getState().saveDraft();
  const failed = studio.useStudio.getState();
  assert(
    "a save that fails says so instead of pretending",
    failed.saving === false &&
      /permission denied/.test(failed.draftError ?? ""),
    String(failed.draftError),
  );

  Object.defineProperty(apiObject, "saveDraft", {
    configurable: true,
    writable: true,
    value: realSaveDraft,
  });
  assert(
    "nothing pending means nothing to flush",
    studio.flushDraftSave() === false,
  );

  /* and the debounce really does write what was queued, before the tab goes away */
  let flushed = 0;
  Object.defineProperty(apiObject, "saveDraft", {
    configurable: true,
    writable: true,
    value: async () => {
      flushed += 1;
    },
  });
  studio.useStudio.getState().setDraft({ title: "Halved by a hidden tab" });
  studio.flushDraftSave();
  await sleep(30);
  assert(
    "a page going away writes what was still in the queue",
    flushed === 1,
    `${flushed} writes`,
  );
  Object.defineProperty(apiObject, "saveDraft", {
    configurable: true,
    writable: true,
    value: realSaveDraft,
  });
  session.useSession.setState({
    user: signedOutUser,
    currentId: signedOutUser?.id ?? null,
  });

  /* ------------------------------------------------- errors that name the cause */

  section("When the database says no, it says which column");

  /* The exact failure an older schema produces: `maqam` is NOT NULL and the audio-only
     client does not send it. This used to be reported as "a nasheed needs its recording
     uploaded", which sent somebody looking for a file they had already uploaded. */
  const { apiErrorFromDb } = await import("../src/lib/api");
  const oldColumn = apiErrorFromDb({
    code: "23502",
    message:
      'null value in column "maqam" of relation "songs" violates not-null constraint',
    details: "Failing row contains (sng_1, null, Ṭalʿa, ...).",
  });
  assert(
    "an old database is named as an old database, not as a missing file",
    /older version of CoolNasheed's schema/.test(oldColumn.message) &&
      !/recording uploaded/.test(oldColumn.message),
    oldColumn.message.slice(0, 90),
  );
  assert(
    "and the message says what to run",
    /npm run setup/.test(oldColumn.message),
    oldColumn.message.slice(0, 90),
  );
  assert(
    "and it is filed as a schema problem, so the studio can act on it",
    oldColumn.field === "schema",
    String(oldColumn.field),
  );

  const noAudio = apiErrorFromDb({
    code: "23502",
    message:
      'null value in column "audio_path" of relation "songs" violates not-null constraint',
    details:
      'null value in column "audio_path" of relation "songs" violates not-null constraint',
  });
  assert(
    "a recording that really is missing says so, and says where to put it",
    /no recording attached yet/.test(noAudio.message) &&
      /step 1/.test(noAudio.message) &&
      noAudio.field === "audio",
    noAudio.message,
  );

  const noTitle = apiErrorFromDb({
    code: "23502",
    message: 'null value in column "title"',
    details: 'null value in column "title"',
  });
  assert(
    "a missing title is called a missing title",
    /needs a title/.test(noTitle.message),
    noTitle.message,
  );

  const required = apiErrorFromDb({
    code: "23514",
    message:
      'new row for relation "songs" violates check constraint "songs_audio_required"',
  });
  assert(
    "a nasheed that cannot go live without audio says which step to do",
    /cannot go live without its recording/.test(required.message) &&
      /step 1/.test(required.message),
    required.message,
  );
  assert(
    "and the raw constraint name never reaches the screen",
    !/check constraint|songs_audio_required/.test(required.message),
    required.message,
  );

  const other = apiErrorFromDb({
    code: "23514",
    message:
      'new row for relation "songs" violates check constraint "songs_year_shape"',
  });
  assert(
    "any other rule names itself rather than printing SQL",
    other.message === 'That does not satisfy "songs_year_shape".',
    other.message,
  );

  const unbuilt = apiErrorFromDb({
    code: "PGRST205",
    message: "Could not find the table 'public.songs'",
  });
  assert(
    "a project with no schema says so",
    /no tables yet/.test(unbuilt.message) && unbuilt.field === "schema",
    unbuilt.message,
  );

  /* -------------------------------------------------- typing in a real field */

  section("Handing over the SQL that repairs a project");

  /* The button fetches this file, so the file has to exist, be current, and carry the
     table the app reads at boot. A stale copy here is a repair that does not repair. */
  const served = join(process.cwd(), "public/setup.sql");
  const canonical = readFileSync(
    join(process.cwd(), "supabase/setup.sql"),
    "utf8",
  );
  assert(
    "the repair SQL is served with the app, and is the current bundle",
    readFileSync(served, "utf8") === canonical,
    `${canonical.length} bytes served, ${readFileSync(served, "utf8").length} on disk`,
  );
  /* Every file that applies the schema must discover it. A remembered list is how a
     project ends up four migrations in and sure it is current: this exact bug left a real
     project with the pre-audio schema while `npm run setup` reported success. */
  for (const file of [
    "scripts/setup.mjs",
    "scripts/sql-bundle.mjs",
    "scripts/pg-test.mjs",
  ]) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert(
      `${file} reads the migrations folder rather than a remembered list`,
      source.includes("supabase/migrations") &&
        !/MIGRATIONS\s*=\s*\[/.test(source),
      /MIGRATIONS\s*=\s*\[/.test(source)
        ? "the migrations are listed in the script instead of read from the folder"
        : "",
    );
  }

  assert(
    "and it contains the table the app asks about its schema",
    canonical.includes("public.app_schema") &&
      canonical.includes("profile-pictures-1") &&
      canonical.includes("catalogue-window-1"),
  );
  assert(
    "and the picture schema travels in the same paste",
    canonical.includes("avatar_path") &&
      canonical.includes("nasheed-avatars") &&
      /\(\s*'nasheed-avatars', 'nasheed-avatars', true, 1048576/m.test(canonical),
  );

  /* The file gets pasted onto databases that are already part way through — a project one
     migration behind, or one that has them all — so every migration inside it has to carry
     the guard that skips what is done. Without the guard a second paste dies on migration
     2: its `trending()` body selects a column a later migration drops. */
  const guards = (canonical.match(/do \$cn_migration\$/g) ?? []).length;
  const migrationCount = readdirSync(
    join(process.cwd(), "supabase/migrations"),
  ).filter((name) => name.endsWith(".sql")).length;
  assert(
    `each of the ${migrationCount} migrations in the paste is guarded`,
    guards === migrationCount,
    `${guards} guards for ${migrationCount} migrations`,
  );
  assert(
    "and the paste keeps its own record of what it has applied",
    canonical.includes(
      "create table if not exists public.applied_migrations",
    ) &&
      canonical.includes(
        "revoke all on public.applied_migrations from anon, authenticated",
      ),
    "the ledger is there, and closed to the API",
  );

  const { SetupSqlButton } = await import("../src/components/SetupSqlButton");
  const setupHost = w.document.createElement("div");
  w.document.body.appendChild(setupHost);
  const setupRoot = createRoot(setupHost);
  const sqlText =
    "create table if not exists public.songs (id text primary key);\n";

  let askedFor = "";
  const fetchBeforeSetupButton = globalThis.fetch;
  setGlobal("fetch", async (input: RequestInfo | URL) => {
    askedFor = String(input);
    return { ok: true, status: 200, text: async () => sqlText } as Response;
  });

  let copied = "";
  Object.defineProperty(w.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void (copied = text) },
  });

  await act(async () => {
    setupRoot.render(createElement(SetupSqlButton));
  });
  const button = setupHost.querySelector("button")!;
  assert(
    "the button says what it will do before it is pressed",
    /sql/i.test(button.textContent ?? ""),
    button.textContent ?? "",
  );
  assert("and nothing is fetched until it is pressed", askedFor === "");

  await act(async () => {
    button.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  });
  setupRoot.unmount();
  assert(
    "one click puts the whole repair on the clipboard",
    copied === sqlText && askedFor === "/setup.sql",
    `asked for ${askedFor || "nothing"}, copied ${copied.length} characters`,
  );

  /* Inside an iframe that was not granted `clipboard-write` — the sandboxed preview this
     app is usually looked at in — the clipboard API throws. It must not end there: the
     legacy copy path runs, and if that is gone too the SQL appears in a box on the page,
     already selected, where ⌘C always works. */
  Object.defineProperty(w.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        throw new Error("NotAllowedError: clipboard-write is not granted");
      },
    },
  });

  let legacyCopied = "";
  const realExecCommand = (w.document as unknown as { execCommand?: unknown })
    .execCommand;
  (w.document as unknown as { execCommand: unknown }).execCommand = (
    command: string,
  ) => {
    if (command !== "copy") return false;
    const scratch = w.document.querySelector("textarea[readonly]");
    legacyCopied = scratch ? (scratch as HTMLTextAreaElement).value : "";
    return legacyCopied.length > 0;
  };

  const legacyHost = w.document.createElement("div");
  w.document.body.appendChild(legacyHost);
  const legacyRoot = createRoot(legacyHost);
  await act(async () => {
    legacyRoot.render(createElement(SetupSqlButton));
  });
  await act(async () => {
    legacyHost
      .querySelector("button")!
      .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  });
  const legacyText = legacyHost.textContent ?? "";
  legacyRoot.unmount();
  assert(
    "a clipboard that refuses falls back to the legacy copy, and says it copied",
    legacyCopied === sqlText && /copied/i.test(legacyText),
    `copied ${legacyCopied.length} characters — ${legacyText}`,
  );

  /* Neither path available: nothing is swallowed, the SQL is put in front of the person. */
  (w.document as unknown as { execCommand: unknown }).execCommand = () => false;

  const boxHost = w.document.createElement("div");
  w.document.body.appendChild(boxHost);
  const boxRoot = createRoot(boxHost);
  await act(async () => {
    boxRoot.render(createElement(SetupSqlButton));
  });
  await act(async () => {
    boxHost
      .querySelector("button")!
      .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  });
  const textarea = boxHost.querySelector(
    "textarea",
  ) as HTMLTextAreaElement | null;
  const boxText = boxHost.textContent ?? "";
  assert(
    "and with no clipboard at all the SQL is on the page, whole and selected",
    textarea?.value === sqlText &&
      textarea.selectionEnd === sqlText.length &&
      /⌘C|Ctrl\+C/i.test(boxText),
    textarea
      ? `${textarea.value.length} characters, selected ${textarea.selectionStart}–${textarea.selectionEnd}`
      : "no box appeared",
  );
  boxRoot.unmount();

  (w.document as unknown as { execCommand: unknown }).execCommand =
    realExecCommand;

  setGlobal("fetch", fetchBeforeSetupButton);

  /* The old demo catalogue protected its fictional publishers from impersonation by
     reserving their handles — in the migration and again in the client. Both lists are
     the project's own names now, and this keeps them that way: a handle for a character
     that does not exist is mock data with a job title. */
  const reservedMigration = readFileSync(
    join(process.cwd(), "supabase/migrations", "20260914120000_core.sql"),
    "utf8",
  );
  const reservedBlock = reservedMigration.slice(
    reservedMigration.indexOf("insert into public.reserved_handles"),
    reservedMigration.indexOf(
      "on conflict do nothing",
      reservedMigration.indexOf("insert into public.reserved_handles"),
    ),
  );
  const reservedHandles = [...reservedBlock.matchAll(/'([a-z0-9_.]+)'/g)].map(
    (m) => m[1],
  );
  assert(
    "the database reserves the project's own names and nobody else's",
    reservedHandles.length === 5 &&
      reservedHandles.every((h) =>
        ["coolnasheed", "admin", "root", "staff", "system"].includes(h),
      ),
    reservedHandles.join(", "),
  );

  const sessionSource = readFileSync(
    join(process.cwd(), "src/store/session.ts"),
    "utf8",
  );
  const sessionBlock = sessionSource.slice(
    sessionSource.indexOf("const RESERVED = new Set(["),
    sessionSource.indexOf(
      "]);",
      sessionSource.indexOf("const RESERVED = new Set(["),
    ),
  );
  const sessionHandles = [...sessionBlock.matchAll(/"([a-z0-9_.]+)"/g)].map(
    (m) => m[1],
  );
  assert(
    "and the client's copy of that list is the same five names",
    sessionHandles.length === reservedHandles.length &&
      sessionHandles.every((h) => reservedHandles.includes(h)),
    sessionHandles.join(", "),
  );

  section("A keyboard that knows when you are typing");

  const { isTextField, useKeyboard } = await import("../src/lib/hooks");

  const plain = w.document.createElement("div");
  const field = w.document.createElement("input");
  const rich = w.document.createElement("div");
  rich.setAttribute("contenteditable", "true");
  w.document.body.append(plain, field, rich);
  assert("an input is a field", isTextField(field) === true);
  assert("so is a rich-text box", isTextField(rich) === true);
  assert("a div is not", isTextField(plain) === false);

  const fired: string[] = [];
  function KeyProbe() {
    useKeyboard({
      " ": () => fired.push("space"),
      "?": () => fired.push("question"),
      n: () => fired.push("n"),
      Escape: () => fired.push("escape"),
      "mod+k": () => fired.push("command"),
    });
    return null;
  }
  const probeHost = w.document.createElement("div");
  w.document.body.appendChild(probeHost);
  const probeRoot = createRoot(probeHost);
  await act(async () => {
    probeRoot.render(createElement(KeyProbe));
  });
  await sleep(20);

  const press = (el: Element, key: string, mods: KeyboardEventInit = {}) => {
    el.dispatchEvent(
      new w.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...mods,
      }),
    );
  };

  press(field, " ");
  assert(
    "a space in a text field is a space, not play/pause",
    fired.length === 0,
    fired.join(","),
  );
  press(field, "?");
  assert(
    "and a question mark does not open a panel over the form",
    fired.length === 0,
    fired.join(","),
  );
  press(field, "n");
  assert(
    "and a letter does not skip a track",
    fired.length === 0,
    fired.join(","),
  );
  press(field, "k", { metaKey: true });
  assert(
    "modified combinations still work while typing",
    fired.includes("command"),
    fired.join(","),
  );
  press(field, "Escape");
  assert(
    "and Escape still closes what is open",
    fired.includes("escape"),
    fired.join(","),
  );

  /* A focused control owns its own space: the browser presses the button, and the
     app-wide play/pause must not fire as well. Two effects from one press is what made
     dismissing a sheet feel like it kept pressing what was underneath it. */
  const { isInteractiveTarget, swallowNextClick } = await import("../src/lib/hooks");
  const control = w.document.createElement("button");
  const roleControl = w.document.createElement("span");
  roleControl.setAttribute("role", "button");
  control.appendChild(roleControl);
  w.document.body.appendChild(control);
  assert(
    "a button is something the browser presses",
    isInteractiveTarget(control) === true && isInteractiveTarget(roleControl) === true,
  );
  fired.length = 0;
  press(control, " ");
  assert(
    "so a space on a button is the button's, and does not also play/pause",
    fired.length === 0,
    fired.join(","),
  );
  press(control, "Enter");
  assert("and so is Enter", fired.length === 0, fired.join(","));
  press(control, " ", { metaKey: true });
  assert(
    "while a modified combination is still the app's",
    fired.includes("space"),
    fired.join(","),
  );

  fired.length = 0;
  press(w.document.body, " ");
  press(w.document.body, "?");
  press(w.document.body, "n");
  assert(
    "with nothing focused, the shortcuts are shortcuts again",
    fired.join(",") === "space,question,n",
    fired.join(","),
  );
  control.remove();

  /* One tap, one effect: the tap that dismisses a menu must not also press what the
     menu was covering. */
  const under = w.document.createElement("button");
  let pressed = 0;
  under.addEventListener("click", () => {
    pressed += 1;
  });
  w.document.body.appendChild(under);
  swallowNextClick();
  under.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert(
    "the tap that closed something does not press what it covered",
    pressed === 0,
    `pressed ${pressed} time(s)`,
  );
  under.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert("and the next tap presses normally", pressed === 1, `pressed ${pressed} time(s)`);
  under.remove();
  await act(async () => {
    probeRoot.unmount();
  });
  probeHost.remove();

  /* ------------------------------------------------------- dialogs and focus */

  section("A dialog that opens on the field, not on its close button");

  const { Modal } = await import("../src/components/ui/Primitives");
  const dialogHost = w.document.createElement("div");
  w.document.body.appendChild(dialogHost);
  const dialogRoot = createRoot(dialogHost);
  const renderDialog = (close: () => void) =>
    createElement(Modal, {
      open: true,
      onClose: close,
      title: "Welcome back",
      children: renderFields(),
    });
  const renderFields = () =>
    createElement(
      "form",
      null,
      createElement("input", { className: "field", defaultValue: "" }),
      createElement("input", { className: "field", defaultValue: "" }),
    );

  await act(async () => {
    dialogRoot.render(renderDialog(() => {}));
  });
  await sleep(70);
  const firstField = w.document.querySelector<HTMLInputElement>(`.field`);
  assert(
    "the first field takes focus, not the close button",
    w.document.activeElement === firstField,
    w.document.activeElement?.tagName ?? "nothing",
  );

  /* the parent re-renders on every keystroke, handing the dialog a new onClose —
     which used to re-run its autofocus and yank the caret out of the field */
  firstField?.focus();
  for (const ch of "hafsa") {
    await act(async () => {
      dialogRoot.render(renderDialog(() => {}));
    });
    press(firstField!, ch);
    await sleep(50);
  }
  assert(
    "typing does not move the caret out of the field",
    w.document.activeElement === firstField,
    w.document.activeElement?.tagName ?? "nothing",
  );
  await act(async () => {
    dialogRoot.unmount();
  });
  dialogHost.remove();

  /* ------------------------------------------------------------- as a toast */

  section("Errors arrive as toasts");

  const { ToastHost, useErrorToast } =
    await import("../src/components/ui/Primitives");
  function ErrorProbe({ message }: { message: string | null }) {
    useErrorToast(message);
    return null;
  }
  const toastHost = w.document.createElement("div");
  w.document.body.appendChild(toastHost);
  const toastRoot = createRoot(toastHost);
  await act(async () => {
    toastRoot.render(
      createElement(
        ToastHost,
        null,
        createElement(ErrorProbe, { message: null }),
      ),
    );
  });
  await act(async () => {
    toastRoot.render(
      createElement(
        ToastHost,
        null,
        createElement(ErrorProbe, {
          message:
            "A nasheed needs its recording uploaded before it can be published.",
        }),
      ),
    );
  });
  await sleep(40);
  assert(
    "a refusal is announced at the bottom of the screen, not above the fold",
    (w.document.body.textContent ?? "").includes(
      "needs its recording uploaded",
    ),
    (w.document.body.textContent ?? "").slice(-90),
  );
  await act(async () => {
    toastRoot.unmount();
  });
  toastHost.remove();

  /* ---------------------------------------------------------- size planning */

  section("Making an upload fit");

  const compress = await import("../src/lib/compress");
  const { MAX_AUDIO_BYTES, MAX_ARTWORK_BYTES } =
    await import("../shared/types");

  assert(
    "a recording is capped at 5 MB",
    MAX_AUDIO_BYTES === 5 * 1048576,
    `${MAX_AUDIO_BYTES} bytes`,
  );
  assert(
    "cover art is capped at 2 MB",
    MAX_ARTWORK_BYTES === 2 * 1048576,
    `${MAX_ARTWORK_BYTES} bytes`,
  );

  assert(
    "something inside the limit is left alone",
    compress.planAudio(4 * 1048576, 300).action === "keep",
  );
  const fiveMinutes = compress.planAudio(6 * 1048576, 300);
  assert(
    "a six-megabyte, five-minute recording is re-encoded to fit",
    fiveMinutes.action === "encode" &&
      fiveMinutes.kbps >= 48 &&
      fiveMinutes.kbps <= 160,
    JSON.stringify(fiveMinutes),
  );
  if (fiveMinutes.action === "encode") {
    const projected = (fiveMinutes.kbps * 1000 * 300) / 8;
    assert(
      "and the bitrate it picks actually fits",
      projected <= MAX_AUDIO_BYTES,
      `${Math.round(projected / 1048576)} MB projected`,
    );
  }
  assert(
    "a voice recording is downmixed, a longer one is not",
    (compress.planAudio(9 * 1048576, 800) as { mono?: boolean }).mono === true,
  );
  assert(
    "twenty minutes cannot honestly be squeezed into 5 MB, so it is refused",
    compress.planAudio(30 * 1048576, 1200).action === "impossible",
    JSON.stringify(compress.planAudio(30 * 1048576, 1200)),
  );
  assert(
    "an unknown duration is refused rather than guessed at",
    compress.planAudio(9 * 1048576, 0).action === "impossible",
  );

  const box = compress.fitWithin(4000, 2000, 1600);
  assert(
    "a wide image is scaled to fit the box, keeping its shape",
    box.width === 1600 && box.height === 800,
    `${box.width}×${box.height}`,
  );
  const small = compress.fitWithin(300, 200, 1600);
  assert(
    "and a small one is never blown up",
    small.width === 300 && small.height === 200,
  );

  const tinyArt = new File([new Uint8Array(1024)], "cover.png", {
    type: "image/png",
  });
  const tinySong = new File([new Uint8Array(1024)], "talaa.mp3", {
    type: "audio/mpeg",
  });
  assert(
    "an image already under the limit is uploaded untouched",
    (await compress.shrinkImage(tinyArt)) === tinyArt,
  );
  assert(
    "so is an mp3 under the limit",
    (await compress.shrinkAudio(tinySong)) === tinySong,
  );

  /* jsdom has no decoder and no canvas, so an over-limit file has to be refused in
     words there — which is the honest outcome in any browser that cannot do it */
  const heavySong = new File([new Uint8Array(6 * 1048576)], "long.mp3", {
    type: "audio/mpeg",
  });
  let heavyError: unknown = null;
  try {
    await compress.shrinkAudio(heavySong, MAX_AUDIO_BYTES);
  } catch (err) {
    heavyError = err;
  }
  assert(
    "a browser that cannot re-encode says so instead of uploading a broken file",
    heavyError instanceof Error && /re-encode|decoded/.test(heavyError.message),
    heavyError instanceof Error
      ? heavyError.message.slice(0, 80)
      : String(heavyError),
  );

  /* ------------------------------------------------------------------ routes */

  section("Every route renders with nothing published and no backend");
  const App = (await import("../src/App")).default;
  const container = w.document.getElementById("root")!;

  for (const route of [
    "/",
    "/search",
    "/library",
    "/queue",
    "/about",
    `/t/${ROWS[0].id}`,
    "/a/hafsa.noor",
    "/c/col_1",
    "/p/whatever",
    "/studio",
    "/me",
    "/admin",
    "/nope",
  ]) {
    w.history.pushState({}, "", route);
    const routeHost = w.document.createElement("div");
    w.document.body.appendChild(routeHost);
    const root = createRoot(routeHost);
    try {
      await act(async () => {
        root.render(createElement(App));
      });
      await sleep(40);
      const rendered = (routeHost.textContent ?? "").length;
      assert(`${route} renders`, rendered > 0, `${rendered} characters`);
      if (route === "/") {
        /* the shell's motion layer: the page settles in, the frost covers the reading
           area and nothing else, and the top bar carries the material that dissolves
           at its foot rather than a border */
        const main = routeHost.querySelector("main");
        assert(
          "the page settles in rather than appearing",
          main?.classList.contains("route-in") === true,
          main?.className ?? "no main",
        );
        const veil = routeHost.querySelector(".route-veil");
        assert("a frosted veil covers the reading area", veil !== null);
        assert(
          "and it sits beside the scroller, above it",
          veil?.parentElement ===
            routeHost.querySelector("main")?.parentElement?.parentElement,
        );
        assert(
          "the top bar is the dissolving kind",
          routeHost.querySelector("header")?.classList.contains("topbar") ===
            true,
        );
      }
    } catch (err) {
      assert(
        `${route} renders`,
        false,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      try {
        await act(async () => {
          root.unmount();
        });
      } catch {
        /* unmount noise */
      }
      routeHost.remove();
    }
  }

  /* the empty catalogue must say so, and must not invent one. The earlier sections
     hydrated real rows into the registry, so this asks for the state it means to test. */
  catalog.hydrateCatalog({
    songs: [],
    artists: [],
    collections: [],
    tags: [],
  } as never);
  w.history.pushState({}, "", "/");
  const homeHost = w.document.createElement("div");
  w.document.body.appendChild(homeHost);
  const homeRoot = createRoot(homeHost);
  await act(async () => {
    homeRoot.render(createElement(App));
  });
  await sleep(60);
  const homeText = homeHost.textContent ?? "";
  assert(
    "the home page tells the truth about an empty catalogue",
    /Nothing published yet/i.test(homeText),
    homeText.slice(0, 200),
  );
  assert(
    "and it offers the way in rather than a dead end",
    /publish|upload/i.test(homeText),
    homeText.slice(0, 200),
  );
  assert(
    "and it never mentions the synthesised catalogue it used to have",
    !/maqām|duff|synthes|oscillator|Nūr|on-device/i.test(homeText),
    homeText.slice(0, 80),
  );
  await act(async () => {
    homeRoot.unmount();
  });
  homeHost.remove();
  void container;

  /* ------------------------------------------------- your own nasheeds, on your profile */

  /* `account.id` is a handle and a nasheed's `owner_id` is a uuid, so the nasheeds tab
     used to filter every upload out of its own profile. This is that bug, pinned. */
  section("Your own nasheeds, on your own profile");

  const themeLib = await import("../src/lib/theme");
  const libraryStore = await import("../src/store/library");
  const communityStore = await import("../src/store/community");
  const profileUser = {
    id: "hafsa.noor",
    profileId: OWNER,
    handle: "hafsa.noor",
    name: "Hafsa Noor",
    nameAr: null,
    tagline: "",
    bio: "",
    city: "",
    accent: "jade",
    role: "Publisher",
    kind: "artist",
    verified: false,
    createdAt: Date.now(),
    email: null,
  };
  session.useSession.setState({
    user: profileUser as never,
    currentId: profileUser.id,
    accounts: [session.toAccount(profileUser as never)],
  });
  assert(
    "an account carries both its handle and its uuid",
    session.toAccount(profileUser as never).profileId === OWNER,
  );

  const mineTrack = wire.songFromRow(songRow({ owner_id: OWNER, ownerHandle: "hafsa.noor" }) as never);
  const theirTrack = wire.songFromRow(
    songRow({ id: "sng_smoke_0009", title: "Somebody Else's Nasheed", owner_id: SECOND, ownerHandle: "maryam.q" }) as never,
  );
  studio.useStudio.setState({ entries: [mineTrack, theirTrack] });
  communityStore.useCommunity.setState({
    /* already loaded, so the profile does not go looking for a project that is not there */
    mineLoaded: true,
    mine: [
      {
        id: "cmt_1",
        trackId: mineTrack.id,
        authorId: OWNER,
        authorName: "Hafsa Noor",
        authorHandle: "hafsa.noor",
        authorAccent: "jade" as const,
        authorAvatar: null,
        at: Date.now(),
        text: "recorded after fajr",
        amens: 0,
        reports: 0,
        removed: false,
      },
    ],
  });

  w.history.pushState({}, "", "/me");
  const profileHost = w.document.createElement("div");
  w.document.body.appendChild(profileHost);
  const profileRoot = createRoot(profileHost);
  await act(async () => {
    profileRoot.render(createElement(App));
  });
  await sleep(60);
  const profileText = profileHost.textContent ?? "";
  assert(
    "the nasheeds tab shows a nasheed whose owner_id is the uuid",
    profileText.includes(mineTrack.title),
    profileText.slice(0, 160),
  );
  assert(
    "and it does not claim somebody else's",
    !profileText.includes("Somebody Else's Nasheed"),
    profileText.slice(0, 160),
  );
  await act(async () => {
    profileRoot.unmount();
  });
  profileHost.remove();
  session.useSession.setState({ user: signedOutUser, currentId: null, accounts: [] });

  /* ------------------------------------------------------- a picture beside a name */

  /* Profile pictures: one megabyte, its own bucket, and the row stores the path. The
     circle beside a name shows the picture when there is one and initials when there is
     not — nothing generated. */
  section("A picture beside a name");

  const typesLib = await import("../shared/types");
  assert(
    "a picture is capped at one megabyte",
    typesLib.MAX_AVATAR_BYTES === 1048576 &&
      typesLib.MAX_AVATAR_BYTES < typesLib.MAX_ARTWORK_BYTES,
    `${typesLib.MAX_AVATAR_BYTES} bytes`,
  );

  const facePath = `${OWNER}/avatar-1.webp`;
  const meWithFace = wire.userFromRow({
    id: OWNER,
    handle: "hafsa.noor",
    name: "Hafsa Noor",
    name_ar: null,
    tagline: "",
    bio: "",
    city: "",
    accent: "jade",
    role: "listener",
    kind: "artist",
    verified: false,
    avatar_path: facePath,
    created_at: new Date().toISOString(),
  } as never);
  assert(
    "a profile row carries its picture",
    meWithFace.avatarPath === facePath,
    String(meWithFace.avatarPath),
  );

  const noteWithFace = wire.commentFromRow(
    {
      id: "cmt_pic",
      song_id: "sng_smoke_0001",
      author_id: SECOND,
      text: "amin",
      at_line: null,
      edited_at: null,
      amens: 0,
      reports: 0,
      removed: false,
      created_at: new Date().toISOString(),
      author: {
        id: SECOND,
        handle: "maryam.q",
        name: "Maryam Q.",
        accent: "jade",
        verified: false,
        avatar_path: `${SECOND}/avatar-2.png`,
      },
    } as never,
    { id: null, amened: new Set<string>() } as never,
  );
  assert(
    "and so does the author of a note",
    noteWithFace.authorAvatar === `${SECOND}/avatar-2.png`,
    String(noteWithFace.authorAvatar),
  );

  /* Two-foreign-key tables (`amens`, `reports`) give PostgREST a second path between
     comments and profiles, and it refuses to guess which one was meant. The join has to
     name the key. */
  assert(
    "the comment join names the foreign key, or PostgREST refuses it",
    wire.COMMENT_COLUMNS.includes("author:profiles!comments_author_id_fkey"),
    wire.COMMENT_COLUMNS,
  );

  const art = await import("../src/components/art/CoverArt");
  const faceHost = w.document.createElement("div");
  w.document.body.appendChild(faceHost);
  const faceRoot = createRoot(faceHost);
  await act(async () => {
    faceRoot.render(
      createElement(art.Avatar, { name: "Hafsa Noor", size: 40, picture: facePath }),
    );
  });
  const faceImg = faceHost.querySelector("img");
  assert(
    "the circle shows the picture when there is one",
    faceImg?.getAttribute("src") ===
      `https://smoke.supabase.co/storage/v1/object/public/nasheed-avatars/${facePath}`,
    String(faceImg?.getAttribute("src") ?? ""),
  );
  await act(async () => {
    faceRoot.render(createElement(art.Avatar, { name: "Hafsa Noor", size: 40 }));
  });
  assert(
    "and initials when there is not",
    faceHost.querySelector("img") === null &&
      (faceHost.textContent ?? "").includes("HN"),
    faceHost.textContent ?? "",
  );
  await act(async () => {
    faceRoot.unmount();
  });
  faceHost.remove();

  const profilePageSrc = readFileSync(join(process.cwd(), "src/pages/ProfilePage.tsx"), "utf8");
  const apiSrcForPictures = readFileSync(join(process.cwd(), "src/lib/api.ts"), "utf8");
  const sessionSrc = readFileSync(join(process.cwd(), "src/store/session.ts"), "utf8");
  assert(
    "the profile settings offer a picture, with the limit in words",
    profilePageSrc.includes("1 MB at most") &&
      profilePageSrc.includes('type="file"') &&
      profilePageSrc.includes("changeAvatar"),
    "",
  );
  assert(
    "and it goes into the picture bucket before the row points at it",
    apiSrcForPictures.includes('upload(uid, "avatar"') &&
      sessionSrc.includes("api.uploadAvatar(file)"),
    "",
  );

  /* ----------------------------------------------------------- the light book */

  section("The house is bound in the light book");

  const prefs = await import("../shared/types");
  assert(
    "the default is dawn, not night",
    prefs.DEFAULT_PREFS.theme === "dawn" &&
      libraryStore.DEFAULT_SETTINGS.theme === "dawn",
    `${prefs.DEFAULT_PREFS.theme}`,
  );
  assert(
    "a device that has never chosen shows the default",
    themeLib.resolveTheme(null, null) === "dawn",
    themeLib.resolveTheme(null, null),
  );
  assert(
    "an account that saved night, on a device that never chose, is honoured",
    themeLib.resolveTheme(null, "night") === "night",
    String(themeLib.resolveTheme(null, "night")),
  );
  assert(
    "but the machine's own choice wins over the account's",
    themeLib.resolveTheme("night", "dawn") === "night" &&
      themeLib.resolveTheme("dawn", "night") === "dawn",
  );
  /* A value the app wrote while showing it is not a decision. This is the bug that made
     "light is the default" false in practice: the app stored whatever it resolved, an
     account row carrying the old `night` column default resolved to night, and the device
     then insisted on it forever. */
  themeLib.storeTheme("night");
  assert(
    "a theme the app was merely showing is not a choice",
    w.localStorage.getItem("coolnasheed.theme") === "night" &&
      themeLib.readStoredTheme() === null,
  );
  themeLib.storeTheme("night", { explicit: true });
  assert(
    "but a theme somebody picked is remembered where the first paint can find it",
    themeLib.readStoredTheme() === "night" &&
      w.localStorage.getItem("coolnasheed.theme.chosen") === "1",
  );
  assert(
    "and picking one in the settings store is a decision too",
    (() => {
      w.localStorage.clear();
      libraryStore.useLibrary.getState().setSetting("theme", "night");
      const ok =
        w.localStorage.getItem("coolnasheed.theme.chosen") === "1" &&
        themeLib.readStoredTheme() === "night";
      libraryStore.useLibrary.getState().setSetting("theme", "dawn");
      return ok;
    })(),
  );
  w.localStorage.clear();

  const indexHtml = readFileSync(join(process.cwd(), "index.html"), "utf8");
  assert(
    "index.html paints light before React exists",
    /<html[^>]*data-theme="dawn"/.test(indexHtml) &&
      indexHtml.includes("coolnasheed.theme") &&
      /name="theme-color" content="#F4EFE3"/.test(indexHtml),
    indexHtml.slice(0, 120),
  );
  assert(
    "and it only lets a chosen theme change that, never a leftover one",
    indexHtml.includes("coolnasheed.theme.chosen"),
  );
  const apiSrcForPrefs = readFileSync(join(process.cwd(), "src/lib/api.ts"), "utf8");
  assert(
    "the account learns which themes were choices",
    /theme_chosen_at = new Date\(\)\.toISOString\(\)/.test(apiSrcForPrefs),
  );
  assert(
    "and the paste heals rows written under the old night default, once",
    canonical.includes("theme_chosen_at") &&
      /set theme = 'dawn'\s*\n\s*where theme = 'night'\s*\n\s*and theme_chosen_at is null/.test(
        canonical,
      ),
  );
  assert(
    "and it does not advertise a synthesis engine any more",
    !/synthesis|synthesi[sz]ed/i.test(indexHtml),
  );

  /* Words over artwork sit on a veil, and the veil is a token: charcoal with ivory
     words in the night book, cream with ink words in the day book. A photograph does
     not get darker because the page got lighter. */
  const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");
  assert(
    "every veil over artwork is a token, not a black gradient",
    /\.art-scrim \{[^}]*var\(--art-strong\)/s.test(css) &&
      /\.art-scrim-side \{[^}]*var\(--art-strong\)/s.test(css) &&
      /\.art-wash-deep \{[^}]*var\(--art-strong\)/s.test(css) &&
      /\.art-chip \{[^}]*var\(--art-chip\)/s.test(css) &&
      /\.art-fade-top \{[^}]*var\(--art-strong\)/s.test(css),
  );
  assert(
    "and the two books draw a different veil",
    /:root\[data-theme="night"\] \{[^}]*--art-strong: rgba\(3, 9, 7/s.test(css) &&
      /:root\[data-theme="dawn"\] \{[^}]*--art-strong: rgba\(247, 242, 232/s.test(css),
  );

  /* Contrast is arithmetic, so it is checked rather than eyeballed. Every token that
     puts words on a surface has to clear 4.5:1 against the *darkest* surface of its own
     book: text-muted appears 200-odd times and much of it is 11px. This is the check
     that caught the light book being unreadable. */
  const themeOf = (selector: string): Record<string, string> => {
    const at = css.indexOf(selector);
    if (at < 0) return {};
    const open = css.indexOf("{", at);
    const body = css.slice(open + 1, css.indexOf("}", open));
    const found: Record<string, string> = {};
    for (const line of body.split("\n")) {
      const m = /^\s*--c-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/.exec(line);
      if (m) found[m[1]] = m[2];
    }
    return found;
  };
  const channel = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const luminance = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const r = channel(((n >> 16) & 255) / 255);
    const g = channel(((n >> 8) & 255) / 255);
    const b = channel((n & 255) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const WORD_TOKENS = [
    "text",
    "text-2",
    "muted",
    "jade",
    "jade-soft",
    "gold",
    "gold-soft",
    "turq",
    "madder",
    "cobalt",
  ];
  for (const [book, selector] of [
    ["night", ':root[data-theme="night"] {'],
    ["dawn", ':root[data-theme="dawn"] {'],
  ] as const) {
    const t = themeOf(selector);
    const surfaces = ["bg", "surface", "surface-2", "surface-3", "elev"].map(
      (key) => t[key],
    );
    const thin: string[] = [];
    for (const token of WORD_TOKENS) {
      const value = t[token];
      if (!value) {
        thin.push(`${token} (missing)`);
        continue;
      }
      const worst = Math.min(...surfaces.map((s) => contrast(value, s)));
      if (worst < 4.5) thin.push(`${token} ${worst.toFixed(2)}:1`);
    }
    assert(
      `every word token in the ${book} book clears 4.5:1`,
      thin.length === 0,
      thin.join(", "),
    );
  }
  assert(
    "and a cover's shadow is a token, not a black bloom",
    /--shadow-art:/.test(css) &&
      /\.shadow-art \{\s*box-shadow: var\(--shadow-art\)/.test(css),
  );
  /* The lift under glass, cards and the nav pill used to be a hard-coded black bloom,
     which in daylight is exactly the "why does this look like night mode" complaint. */
  assert(
    "the light book lifts with its own colour too",
    /:root\[data-theme="night"\] \{[^}]*--shadow-lift: rgba\(0, 0, 0/s.test(css) &&
      /:root\[data-theme="dawn"\] \{[^}]*--shadow-lift: rgba\(20, 44, 34/s.test(css),
  );
  assert(
    "a menu that dismisses itself swallows the tap that dismissed it",
    /swallowNextClick\(\);/.test(
      readFileSync(join(process.cwd(), "src/components/ui/Menu.tsx"), "utf8"),
    ) &&
      /export function swallowNextClick/.test(
        readFileSync(join(process.cwd(), "src/lib/hooks.ts"), "utf8"),
      ),
  );
  assert(
    "gold ink is a token too, because gold is bright at night and dark in daylight",
    /:root\[data-theme="night"\] \{[^}]*--c-gold-ink: #241a06/s.test(css) &&
      /:root\[data-theme="dawn"\] \{[^}]*--c-gold-ink: #fdf8ec/s.test(css) &&
      /\.btn-gold \{[^}]*color: var\(--c-gold-ink\)/s.test(css),
  );
  assert(
    "and the ink over each book's gold is readable",
    (() => {
      const dawnT = themeOf(':root[data-theme="dawn"] {');
      const nightT = themeOf(':root[data-theme="night"] {');
      const ratioOf = (a: string, b: string) => {
        const lum = (hex: string) => {
          const n = parseInt(hex.slice(1), 16);
          const ch = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
          return (
            0.2126 * ch(((n >> 16) & 255) / 255) +
            0.7152 * ch(((n >> 8) & 255) / 255) +
            0.0722 * ch((n & 255) / 255)
          );
        };
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      return (
        ratioOf(dawnT["gold-ink"], dawnT["gold-soft"]) >= 4.5 &&
        ratioOf(nightT["gold-ink"], nightT["gold-soft"]) >= 4.5
      );
    })(),
  );
  assert(
    "and no rule outside the night book still blooms black",
    css
      .split(':root[data-theme="dawn"]')[1]
      .replace("--shadow-lift: rgba(20, 44, 34, 0.34);", "")
      .includes("rgba(0, 0, 0, 0.95)") === false,
  );
  assert(
    "the dimmer behind a dialog is a token as well",
    /:root\[data-theme="night"\] \{[^}]*--scrim: rgba\(3, 9, 7/s.test(css) &&
      /:root\[data-theme="dawn"\] \{[^}]*--scrim: rgba\(18, 36, 29/s.test(css) &&
      /\.scrim \{\s*background: var\(--scrim\)/.test(css),
  );
  const scrimFiles = [
    "src/components/CommandPalette.tsx",
    "src/components/ui/Primitives.tsx",
  ];
  const scrimCold = scrimFiles.filter((file) =>
    /bg-\[rgba\(3,\s*9,\s*7/.test(readFileSync(join(process.cwd(), file), "utf8")),
  );
  assert(
    "and every dialog dims through the class, not a night-black veil",
    scrimCold.length === 0 &&
      scrimFiles.every((file) =>
        readFileSync(join(process.cwd(), file), "utf8").includes("scrim absolute inset-0"),
      ),
    scrimCold.join(", "),
  );

  /* Your own profile is the one page that promises to list everything you published,
     so it asks the server every time instead of trusting a cached page. */
  const profileSrc = readFileSync(join(process.cwd(), "src/pages/ProfilePage.tsx"), "utf8");
  assert(
    "the profile always refetches what you published",
    /void loadEntries\(true\)/.test(profileSrc) && /void loadNotes\(true\)/.test(profileSrc),
  );

  const overArtFiles = [
    "src/pages/Home.tsx",
    "src/pages/TrackPage.tsx",
    "src/pages/About.tsx",
    "src/pages/ArtistPage.tsx",
    "src/pages/LibraryPage.tsx",
    "src/components/collection/Cards.tsx",
    "src/components/collection/HeroPanel.tsx",
    "src/components/track/TrackViews.tsx",
    "src/components/player/PlayerBar.tsx",
    "src/components/player/ImmersivePlayer.tsx",
    "src/components/player/LyricStage.tsx",
  ];
  const missingOverArt = overArtFiles.filter(
    (file) => !readFileSync(join(process.cwd(), file), "utf8").includes("over-art"),
  );
  assert(
    "every surface that writes over artwork carries the class",
    missingOverArt.length === 0,
    missingOverArt.join(", "),
  );

  /* ------------------------------------------------------- a crash is not a blank page */

  const boundarySrc = readFileSync(
    join(process.cwd(), "src/components/layout/ErrorBoundary.tsx"),
    "utf8",
  );
  assert(
    "a render that throws is caught rather than left as a white screen",
    /getDerivedStateFromError/.test(boundarySrc) &&
      /componentDidCatch/.test(boundarySrc),
  );
  assert(
    "and the way out is a retry, a home link and a reload — not a stack trace",
    /Try again/.test(boundarySrc) &&
      /Go home/.test(boundarySrc) &&
      /window\.location\.reload\(\)/.test(boundarySrc),
  );
  const shellSrc = readFileSync(
    join(process.cwd(), "src/components/layout/AppShell.tsx"),
    "utf8",
  );
  const mainSrc = readFileSync(join(process.cwd(), "src/main.tsx"), "utf8");
  assert(
    "it is mounted around the page and around the whole app, so the tab bar survives",
    /<ErrorBoundary label="this page">/.test(shellSrc) &&
      /<ErrorBoundary label="the app"/.test(mainSrc),
  );

  /* ------------------------------------------------- starting over leaves nothing behind */

  const apiSrcForCleanup = readFileSync(join(process.cwd(), "src/lib/api.ts"), "utf8");
  assert(
    "a discarded draft takes its uploads with it",
    /removeUploads: async/.test(apiSrcForCleanup),
  );
  const studioSrc = readFileSync(join(process.cwd(), "src/store/studio.ts"), "utf8");
  assert(
    "starting over, clearing the recording and replacing a file all tidy up",
    (studioSrc.match(/removeUploads\(/g) ?? []).length >= 4 &&
      /if \(!stillUsed\(entries, discarded\.audioPath\)\)/.test(studioSrc),
  );
  assert(
    "and a file a published nasheed still plays is never deleted",
    /function stillUsed\(/.test(studioSrc) &&
      /song\.audioPath === path \|\| song\.artworkPath === path/.test(studioSrc),
  );

  /* ------------------------------------------- the catalogue is fetched, not carried */

  const searchSrc = readFileSync(join(process.cwd(), "src/pages/Search.tsx"), "utf8");
  assert(
    "search asks the database instead of only looking at what booted",
    /api\.songs\(\{\s*q: needle/.test(searchSrc) &&
      /offset: remote\.next/.test(searchSrc) &&
      /searchTracks\(draft\)/.test(searchSrc),
  );
  /* The field is the source of truth while somebody is typing: the address bar is
     written once the typing pauses, and a URL arriving back from that write is not
     allowed to overwrite the text — which is how a space at the end of a word used to
     be swallowed by the write for the character before it. */
  const topbarSrc = readFileSync(join(process.cwd(), "src/components/layout/TopBar.tsx"), "utf8");
  assert(
    "the search field keeps what is being typed, and the address bar follows it",
    /onChange=\{\(e\) => onType\(e\.target\.value\)\}/.test(topbarSrc) &&
      /window\.setTimeout\(\(\) => onSearch\(value\), 220\)/.test(topbarSrc) &&
      /written\.current === url/.test(topbarSrc),
  );
  assert(
    "and the search page does the same, so a space is never overtaken",
    /value=\{draft\}/.test(searchSrc) &&
      /window\.setTimeout\(\(\) => writeQuery\(value\), 220\)/.test(searchSrc) &&
      /written\.current === q\b/.test(searchSrc) &&
      /const needle = draft\.trim\(\)/.test(searchSrc),
  );
  assert(
    "and it says so while it waits, and keeps a way to ask for more",
    /Searching every nasheed/.test(searchSrc) && /More results/.test(searchSrc),
  );
  /* The chart is a strip. Six rows was not the problem — three rows of two-line rows
     under a full-weight header was: it read as a section of the page rather than as a
     glance at what is being played. Now a row is one line tall, three to a row on a
     wide screen, so the whole thing is two lines of a page. */
  const cardsSrcForChart = readFileSync(
    join(process.cwd(), "src/components/collection/Cards.tsx"),
    "utf8",
  );
  const homeSrcForChart = readFileSync(join(process.cwd(), "src/pages/Home.tsx"), "utf8");
  assert(
    "the chart is a strip: one-line rows, three to a row",
    /dense \? "gap-2 px-2 py-0\.5"/.test(cardsSrcForChart) &&
      /lg:grid-cols-3/.test(homeSrcForChart) &&
      /trending\.slice\(0, 6\)/.test(homeSrcForChart),
  );
  assert(
    "and a chart row stays one line tall whatever the title is",
    /dense \? \(\s*\/\* one line/.test(cardsSrcForChart) &&
      /dense \? "h-7 w-7" : "h-10 w-10"/.test(cardsSrcForChart),
  );

  const bootSrc = readFileSync(join(process.cwd(), "src/lib/boot.ts"), "utf8");
  assert(
    "a page that needs a song outside the window can fetch it",
    /export async function ensureSongs/.test(bootSrc) &&
      /export async function ensureArtistSongs/.test(bootSrc) &&
      /api\.songs\(\{ ids: missing \}\)/.test(bootSrc),
  );
  const catalogSrc = readFileSync(join(process.cwd(), "src/data/catalog.ts"), "utf8");
  assert(
    "and the registry can take late arrivals without losing what it has",
    /export function adoptSongs/.test(catalogSrc),
  );
  assert(
    "a reciter whose profile is off-window is fetched whole, not called absent",
    /export async function ensureArtist\(/.test(bootSrc) &&
      /api\.publisher\(handle\)/.test(bootSrc) &&
      /adoptArtists\(\[/.test(bootSrc) &&
      /profile\.songs\s*\.filter\(\(song\) => song && song\.id && song\.audioPath\)/.test(bootSrc),
  );
  const artistPageSrc = readFileSync(join(process.cwd(), "src/pages/ArtistPage.tsx"), "utf8");
  assert(
    "and the page waits for that answer before saying no such reciter",
    /ensureArtist\(id\)/.test(artistPageSrc) &&
      /if \(!artist && looking\)/.test(artistPageSrc) &&
      /aria-busy="true"/.test(artistPageSrc) &&
      /setLooking\(true\)/.test(artistPageSrc),
  );
  assert(
    "a waiting page shows a placeholder, and the placeholder respects reduced motion",
    /\.skeleton \{/.test(css) &&
      /animation: var\(--animate-shimmer\)/.test(css) &&
      /prefers-reduced-motion: reduce/.test(css),
  );
  assert(
    "the loved list and a reciter's page ask for what the window left out",
    /ensureSongs\(library\.liked\)/.test(
      readFileSync(join(process.cwd(), "src/pages/LibraryPage.tsx"), "utf8"),
    ) &&
      /ensureArtist\(id\)/.test(
        readFileSync(join(process.cwd(), "src/pages/ArtistPage.tsx"), "utf8"),
      ),
  );

  /* ------------------------------------------------------------------ noise */

  const realErrors = consoleErrors.filter(
    (e) =>
      !e.includes("act(") &&
      !e.includes("ReactDOMTestUtils") &&
      !e.includes("wrapped into act"),
  );
  assert(
    "no unexpected console.error output",
    realErrors.length === 0,
    realErrors.slice(0, 2).join(" | ").slice(0, 240),
  );

  unsubscribe();
  console.error = realError;

  /* ----------------------------------------------------------------- output */

  console.log(notes.join("\n"));
  if (failures.length) {
    console.log(`\nFAILURES (${failures.length}):`);
    console.log(failures.join("\n"));
    process.exit(1);
  }
  console.log(
    `\nAll ${assertions} checks passed — one <audio> element, ${sent.length} beacon${sent.length === 1 ? "" : "s"}, no synthesis anywhere.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(1);
});
