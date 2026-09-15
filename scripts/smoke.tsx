/**
 * Headless smoke test.
 *
 * Bundled with esbuild and run under jsdom, so the whole app — the registry, the
 * lyric timings, the player, every route — is exercised without a browser:
 *
 *   npm run smoke
 *
 * The catalogue ships empty, so this file brings its own: a handful of nasheeds
 * poured into the registry with `hydrateCatalog()`, the same call the client makes
 * when the server answers. Everything the test reads after that is real code
 * reading real shapes — nothing here is a bundled library, and nothing that is
 * asserted about a nasheed is invented by the app.
 */

import { JSDOM, VirtualConsole } from "jsdom";

/** jsdom shouts about canvas/scrollTo; keep the harness output readable. */
const quietConsole = new VirtualConsole();
quietConsole.on("jsdomError", () => {});
quietConsole.on("error", () => {});

/* ------------------------------------------------------------------ report */

const failures: string[] = [];
const notes: string[] = [];

function assert(name: string, condition: boolean, detail = "") {
  if (condition) notes.push(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else failures.push(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function section(title: string) {
  notes.push(`\n${title}`);
}

/* ---------------------------------------------------------- fake media element */

/**
 * jsdom's `<audio>` is a shell: `play()` throws "not implemented" and there is no
 * clock. This gives the element the four things the player actually reads — a
 * duration per source, a currentTime that advances while playing, a paused flag
 * and a volume — and fires the same events a browser would.
 */
const DURATIONS = new Map<string, number>();
const liveMedia: HTMLMediaElement[] = [];
let mediaPlayCalls = 0;

function installMediaShim(w: Window & typeof globalThis) {
  const proto = w.HTMLMediaElement.prototype as unknown as Record<string, unknown>;

  const store = (el: HTMLMediaElement) => {
    const bag = (el as unknown as { __media?: { time: number; volume: number; playing: boolean } }).__media;
    if (bag) return bag;
    const fresh = { time: 0, volume: 1, playing: false };
    (el as unknown as { __media: typeof fresh }).__media = fresh;
    return fresh;
  };

  Object.defineProperty(proto, "duration", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return DURATIONS.get(this.src) ?? NaN;
    },
  });

  Object.defineProperty(proto, "paused", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return !store(this).playing;
    },
  });

  Object.defineProperty(proto, "ended", {
    configurable: true,
    get() {
      return false;
    },
  });

  Object.defineProperty(proto, "currentTime", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return store(this).time;
    },
    set(this: HTMLMediaElement, value: number) {
      store(this).time = Math.max(0, Number.isFinite(value) ? value : 0);
    },
  });

  Object.defineProperty(proto, "volume", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return store(this).volume;
    },
    set(this: HTMLMediaElement, value: number) {
      store(this).volume = value;
    },
  });

  proto.play = function play(this: HTMLMediaElement) {
    mediaPlayCalls++;
    store(this).playing = true;
    this.dispatchEvent(new w.Event("play"));
    return Promise.resolve();
  };

  proto.pause = function pause(this: HTMLMediaElement) {
    store(this).playing = false;
    this.dispatchEvent(new w.Event("pause"));
  };

  proto.load = function load() {};

  /* The player builds its element with `new Audio()` and never puts it in the
     document, so keep hold of every one that is made. */
  const NativeAudio = w.Audio;
  (w as unknown as { Audio: unknown }).Audio = function FakeAudio(this: unknown, src?: string) {
    const el = new NativeAudio();
    if (src) el.src = src;
    liveMedia.push(el);
    return el;
  };

  // a clock that only moves while something is playing, like the real thing
  w.setInterval(() => {
    for (const el of liveMedia) {
      const bag = (el as unknown as { __media?: { time: number; playing: boolean } }).__media;
      if (!bag?.playing) continue;
      const length = DURATIONS.get(el.src) ?? 0;
      if (length && bag.time + 0.05 >= length) {
        bag.time = length;
        bag.playing = false;
        el.dispatchEvent(new w.Event("ended"));
        continue;
      }
      bag.time += 0.05;
      el.dispatchEvent(new w.Event("timeupdate"));
    }
  }, 50);
}

/* ------------------------------------------------------- fake audio context */

/** Only what the player asks of Web Audio: a source, an analyser, a destination. */
let analysersBuilt = 0;

class FakeAnalyser {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  getByteFrequencyData(arr: Uint8Array) {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(120 + 60 * Math.sin(i / 7));
  }
  connect() {}
  disconnect() {}
}

class FakeAudioContext {
  state = "running";
  destination = { connect() {}, disconnect() {} };
  createMediaElementSource() {
    analysersBuilt++;
    return { connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
  async resume() {
    this.state = "running";
  }
}

/* ------------------------------------------------------------------ jsdom host */

const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="root"></div></body></html>`, {
  url: "http://localhost:5173/",
  pretendToBeVisual: true,
  virtualConsole: quietConsole,
});

const w = dom.window as unknown as Record<string, unknown> & typeof dom.window;
installMediaShim(dom.window as unknown as Window & typeof globalThis);
w.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
(w as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
  cb: (entries: { isIntersecting: boolean; target: Element }[]) => void;
  constructor(cb: (entries: { isIntersecting: boolean; target: Element }[]) => void) {
    this.cb = cb;
  }
  observe(target: Element) {
    this.cb([{ isIntersecting: true, target }]);
  }
  disconnect() {}
  unobserve() {}
};
(w as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  disconnect() {}
  unobserve() {}
};
(w as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
  dispatchEvent: () => false,
});

/** Node 22 makes some globals getter-only, so define rather than assign. */
function setGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

setGlobal("window", w);
setGlobal("document", w.document);
setGlobal("navigator", w.navigator);
setGlobal("localStorage", w.localStorage);
setGlobal("location", w.location);
setGlobal("history", w.history);
setGlobal("CustomEvent", w.CustomEvent);
setGlobal("Event", w.Event);
setGlobal("MouseEvent", w.MouseEvent);
setGlobal("KeyboardEvent", w.KeyboardEvent);
setGlobal("PointerEvent", w.MouseEvent);
setGlobal("HTMLElement", w.HTMLElement);
setGlobal("Element", w.Element);
setGlobal("Node", w.Node);
setGlobal("getComputedStyle", w.getComputedStyle.bind(w));
setGlobal("Audio", (w as unknown as { Audio: unknown }).Audio);
setGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
setGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
setGlobal("IntersectionObserver", (w as unknown as { IntersectionObserver: unknown }).IntersectionObserver);
setGlobal("ResizeObserver", (w as unknown as { ResizeObserver: unknown }).ResizeObserver);
setGlobal("matchMedia", (w as unknown as { matchMedia: unknown }).matchMedia);
setGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------- tests */

async function main() {
  const consoleErrors: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    consoleErrors.push(msg);
    if (!msg.includes("act(") && !msg.includes("ReactDOMTestUtils")) realError(...args);
  };

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");

  /* ---- the empty registry, before anything is published ---- */

  const catalog = await import("../src/data/catalog");
  const { timedLyrics, lineAt } = await import("../src/lib/lyrics");
  const theory = await import("../src/lib/theory");

  section("An empty catalogue");
  assert("the registry starts empty", catalog.TRACKS.length === 0 && catalog.ARTISTS.length === 0);
  assert("looking a nasheed up finds nothing", catalog.getTrack("sng_nothing") === undefined);
  assert("and the counts it prints are zero, not invented", catalog.statsFor(catalog.TRACKS[0] ?? ({} as never)).plays === 0);

  {
    const { default: App } = await import("../src/App");
    const host = w.document.createElement("div");
    w.document.body.appendChild(host);
    const root = createRoot(host);
    w.history.pushState({}, "", "/");
    await React.act(async () => {
      root.render(React.createElement(App));
    });
    await sleep(40);
    const text = host.textContent ?? "";
    assert("the home page says so instead of inventing a shelf", text.includes("Nothing here yet"), text.slice(0, 80));
    await React.act(async () => {
      root.unmount();
    });
    host.remove();
  }

  /* ---- the fixture: what a `catalog` payload from the server looks like ---- */

  const now = Date.now();
  const song = (over: Record<string, unknown>) => ({
    id: "sng_x",
    ownerId: "uuid-1",
    ownerHandle: "test.reciter",
    title: "A Nasheed",
    titleAr: null,
    note: "",
    maqam: "hijaz",
    year: 2025,
    tags: ["test"],
    lines: [{ tr: "ya rabbi", en: "O my Lord" }],
    audioPath: null,
    audioMime: null,
    durationMs: null,
    artworkPath: null,
    status: "live",
    publishedAt: now,
    plays: 0,
    likes: 0,
    notes: 0,
    ...over,
  });

  const songs = [
    song({
      id: "sng_fajr",
      title: "City of Fajr",
      titleAr: "مدينة الفجر",
      note: "Recorded before dawn.",
      maqam: "bayati",
      year: 2024,
      tags: ["fajr", "test"],
      audioPath: "audio/fajr.mp3",
      audioMime: "audio/mpeg",
      durationMs: 214_000,
      lines: [
        { tr: "ya rabbi", ar: "يا ربي", en: "O my Lord", t: 0 },
        { tr: "salli ala", en: "Bless him", t: 34 },
        { tr: "wa sallim", en: "and grant peace", note: "traditional", t: 88 },
      ],
      plays: 412,
      likes: 33,
      notes: 4,
      publishedAt: now - 86_400_000 * 9,
    }),
    song({
      id: "sng_sakina",
      title: "Sakīna",
      maqam: "hijaz",
      year: 2023,
      tags: ["still", "test"],
      audioPath: "audio/sakina.mp3",
      audioMime: "audio/mpeg",
      durationMs: 268_000,
      lines: [
        { tr: "first line of the quiet one", en: "the first" },
        { tr: "second line of the quiet one", en: "the second" },
        { tr: "third line of the quiet one", en: "the third" },
        { tr: "fourth line of the quiet one", en: "the fourth" },
      ],
      plays: 1204,
      likes: 190,
      notes: 21,
      publishedAt: now - 86_400_000 * 30,
    }),
    song({
      id: "sng_no-audio",
      title: "Words Without A Recording",
      maqam: "rast",
      year: 2025,
      tags: ["test"],
      ownerHandle: "test.ensemble",
      ownerId: "uuid-2",
      lines: [{ tr: "sung alone", en: "sung alone" }],
      publishedAt: now - 86_400_000,
    }),
    song({
      id: "sng_badru",
      title: "Ṭalaʿa al-Badru",
      titleAr: "طلع البدر علينا",
      maqam: "hijazkar",
      year: 2022,
      tags: ["traditional", "test"],
      ownerHandle: "test.ensemble",
      ownerId: "uuid-2",
      audioPath: "audio/badru.m4a",
      audioMime: "audio/mp4",
      durationMs: 196_000,
      artworkPath: "art/badru.png",
      lines: [
        { tr: "talaʿa al-badru ʿalayna", ar: "طلع البدر علينا", en: "The full moon rose upon us", note: "traditional", t: 2 },
        { tr: "min thaniyyati al-wadaʿ", en: "from the valley of Wadāʿ", note: "traditional", t: 26 },
      ],
      plays: 88,
      likes: 9,
      notes: 1,
      publishedAt: now - 86_400_000 * 60,
    }),
    song({
      id: "sng_laylat",
      title: "Laylat al-Qadr",
      maqam: "saba",
      year: 2026,
      tags: ["ramadan", "test"],
      audioPath: "audio/laylat.mp3",
      audioMime: "audio/mpeg",
      durationMs: 302_000,
      lines: [
        { tr: "the odd nights are the good ones", en: "the odd nights", t: 0 },
        { tr: "better than a thousand months", en: "better than a thousand", note: "Qurʾān 97:3", t: 70 },
      ],
      plays: 12,
      likes: 2,
      notes: 0,
      publishedAt: now - 86_400_000 * 3,
    }),
    song({
      id: "sng_dhikr",
      title: "Subḥān Allāh",
      maqam: "kurd",
      year: 2025,
      tags: ["dhikr", "test"],
      ownerHandle: "test.ensemble",
      ownerId: "uuid-2",
      audioPath: "audio/dhikr.ogg",
      audioMime: "audio/ogg",
      durationMs: 148_000,
      lines: [{ tr: "subhana allah", en: "Glory be to God", t: 0 }],
      plays: 640,
      likes: 71,
      notes: 8,
      publishedAt: now - 86_400_000 * 14,
    }),
  ];

  const artist = (over: Record<string, unknown>) => ({
    id: "test.reciter",
    profileId: "uuid-1",
    handle: "test.reciter",
    name: "Test Reciter",
    nameAr: null,
    role: "voice, no instruments",
    origin: "Algiers",
    bio: "Publishes the smoke fixture.",
    seed: "seed-reciter",
    verified: true,
    kind: "artist",
    songs: 0,
    followers: 0,
    ...over,
  });

  const artists = [
    artist({}),
    artist({
      id: "test.ensemble",
      profileId: "uuid-2",
      handle: "test.ensemble",
      name: "Test Ensemble",
      role: "seven voices",
      origin: "Cairo",
      seed: "seed-ensemble",
      verified: false,
    }),
  ];

  const collection = (over: Record<string, unknown>) => ({
    id: "col_fajr",
    kind: "mukhtarat",
    title: "Before Dawn",
    titleAr: null,
    curator: "CoolNasheed",
    blurb: "For the hour before Fajr.",
    seed: "seed-shelf",
    tags: ["fajr"],
    year: 2026,
    songIds: ["sng_fajr", "sng_sakina"],
    ...over,
  });

  const collections = [
    collection({}),
    collection({
      id: "col_ramadan",
      kind: "mix",
      title: "Ramadan Nights",
      blurb: "The last ten.",
      seed: "seed-ramadan",
      tags: ["ramadan"],
      songIds: ["sng_laylat", "sng_sakina", "sng_badru"],
    }),
  ];

  section("Hydration (what the server sends)");
  const hydrated = catalog.hydrateCatalog({ artists, songs, collections } as never);
  assert(`${hydrated} nasheeds registered`, hydrated === songs.length, `${catalog.TRACKS.length} in the registry`);
  assert(`${catalog.ARTISTS.length} publishers registered`, catalog.ARTISTS.length === 2);
  assert(`${catalog.COLLECTIONS.length} shelves registered`, catalog.COLLECTIONS.length === 2);

  const noArtist = catalog.TRACKS.filter((t) => !catalog.getArtist(t.artistId));
  assert("every nasheed is credited to a publisher in the same payload", noArtist.length === 0, noArtist.map((t) => t.id).join(","));

  const orphans = catalog.COLLECTIONS.flatMap((c) => c.trackIds).filter((id) => !catalog.getTrack(id));
  assert("every shelf points at real nasheeds", orphans.length === 0, orphans.join(","));

  const ids = catalog.TRACKS.map((t) => t.id);
  assert("nasheed ids are unique", new Set(ids).size === ids.length);

  const linked = catalog.TRACKS.filter((t) => t.collections.length > 0);
  assert("and the shelves are linked back onto their nasheeds", linked.length === 4, `${linked.length} of ${ids.length} appear in a shelf`);

  const fajr = catalog.getTrack("sng_fajr")!;
  assert("a nasheed carries its recording's length", catalog.durationOf(fajr) === 214, `${catalog.durationOf(fajr)}s`);
  assert("and its real counters", catalog.statsFor(fajr).plays === 412);
  assert("a nasheed with no recording says so", catalog.getTrack("sng_no-audio")!.audioUrl === null);

  section("Lyric timings");
  const timed = timedLyrics("sng_fajr", fajr.lines, 214);
  assert("a publisher's timings are used as they stand", timed.lines.map((l) => l.t).join() === "0,34,88");
  assert("each line runs until the next begins", timed.lines[1]!.dur === 54, `${timed.lines[1]!.dur}s`);
  assert("the last line runs to the end of the recording", Math.abs(timed.lines[2]!.t + timed.lines[2]!.dur - 214) < 1e-6);
  assert(
    "words share their line's span",
    timed.lines[0]!.words.length === 2 && timed.lines[0]!.words[0]!.text === "ya" && timed.lines[0]!.words[1]!.text === "rabbi",
    timed.lines[0]!.words.map((wd) => wd.text).join("|"),
  );
  assert(
    "every word sits inside its line",
    timed.lines.every((l) => l.words.every((wd) => wd.t >= l.t - 1e-6 && wd.end <= l.t + l.dur + 1e-6)),
  );
  assert("lineAt() finds the line being sung", lineAt(timed.lines, 40) === 1 && lineAt(timed.lines, 0) === 0 && lineAt(timed.lines, 200) === 2);

  const spread = timedLyrics("sng_sakina", catalog.getTrack("sng_sakina")!.lines, 268);
  assert("untimed lines are spread evenly instead of guessed at", spread.lines.map((l) => Math.round(l.t)).join() === "0,67,134,201");
  assert("and they cover the whole recording", Math.abs(spread.lines[3]!.t + spread.lines[3]!.dur - 268) < 1e-6);

  const empty = timedLyrics("sng_none", [], 0);
  assert("a nasheed with no words is not an error", empty.lines.length === 0);

  section("Maqām reference");
  assert("every maqām has a name, a mood and its steps", theory.MAQAM_NAMES.every((m) => theory.MAQAMAT[m].name && theory.MAQAMAT[m].mood && theory.MAQAMAT[m].steps.length === 7));
  assert(
    "the quarter-tone modes are the ones that say so",
    theory.hasQuarterTones("rast") && theory.hasQuarterTones("bayati") && theory.hasQuarterTones("saba") && !theory.hasQuarterTones("hijaz"),
    theory.MAQAM_NAMES.filter((m) => theory.hasQuarterTones(m)).join(", "),
  );
  assert("labels are names, not slugs", theory.maqamLabel("hijaz") === "Ḥijāz", theory.maqamLabel("hijaz"));
  assert("ten modes are on offer", theory.MAQAM_NAMES.length === 10);

  section("Search & curator");
  assert("title search", catalog.searchTracks("fajr").some((t) => t.id === "sng_fajr"));
  assert("lyric-line search", catalog.searchTracks("thousand months").some((t) => t.id === "sng_laylat"));
  assert("publisher search", catalog.searchArtists("cairo").some((a) => a.id === "test.ensemble"));
  assert("maqām search", catalog.searchTracks("hijaz").length >= 2);
  assert("shelf search", catalog.searchCollections("ramadan").length === 1);
  assert("nonsense search returns nothing", catalog.searchTracks("zzzqqq").length === 0);
  assert("tags are counted across the catalogue", catalog.tagCounts().some((t) => t.tag === "test" && t.count === 6));

  const { generateNurMix, buildTaste } = await import("../src/lib/nur");
  const emptyMix = generateNurMix({ liked: [], history: [], size: 5, seedKey: "smoke-a" });
  assert("Nūr builds a mix from nothing", emptyMix.trackIds.length === 5);
  assert("Nūr mix has no duplicate nasheeds", new Set(emptyMix.trackIds).size === emptyMix.trackIds.length);
  assert("every pick has a reason", emptyMix.picks.every((p) => p.reason.length > 12));
  const deterministic = generateNurMix({ liked: [], history: [], size: 5, seedKey: "smoke-a" });
  assert("same seed, same mix", deterministic.trackIds.join() === emptyMix.trackIds.join());
  const taste = buildTaste(["sng_sakina"], [{ id: "sng_fajr", at: Date.now(), count: 3 }]);
  assert("taste vector learns tags", Object.keys(taste.tags).length > 0);
  assert("and maqām", Object.keys(taste.maqam).length > 0);
  const seededMix = generateNurMix({ liked: ["sng_sakina", "sng_dhikr"], history: [], size: 5, seedKey: "smoke-b", moodId: "still" });
  assert("a mood-constrained mix still fills up", seededMix.trackIds.length === 5);
  assert("taste shifts the picks", seededMix.trackIds.join() !== emptyMix.trackIds.join());

  /* ---- the player ---- */

  section("Player (a real recording, one <audio> element)");
  const { player } = await import("../src/lib/audio/player");
  const AUDIO = "https://example.invalid/storage/v1/object/public/nasheed-audio/fajr.mp3";
  DURATIONS.set(AUDIO, 214);

  let ended = 0;
  player.handlers.onEnded = () => {
    ended++;
  };

  player.load(AUDIO, 0);
  assert("loaded at t=0", Math.abs(player.getTime()) < 0.01);
  assert("nothing is playing yet", !player.playing);
  await player.play();
  assert("playing after play()", player.playing);
  assert("an analyser was wired up for the visualizer", analysersBuilt === 1, `${analysersBuilt} media sources`);
  await sleep(260);
  const advanced = player.getTime();
  assert("the element's clock advances", advanced > 0.05, `${advanced.toFixed(2)}s`);
  const spectrum = player.readSpectrum();
  assert("the spectrum is readable", spectrum.length > 0 && spectrum[0] !== undefined, `${spectrum.length} bins`);

  player.setVolume(4);
  assert("out-of-range volume is clamped", player.getVolume() === 1, String(player.getVolume()));
  player.setVolume(0.4);
  assert("0.4 reaches the element", Math.abs(player.getVolume() - 0.4) < 1e-9);

  player.seek(30);
  assert("seek lands on the target", Math.abs(player.getTime() - 30) < 0.001, player.getTime().toFixed(2));
  player.pause();
  assert("paused", !player.playing);
  const pausedAt = player.getTime();
  await sleep(140);
  assert("the clock holds while paused", Math.abs(player.getTime() - pausedAt) < 1e-6);

  await player.play();
  player.seek(213.9);
  await sleep(300);
  assert("reaches the end and fires onEnded", ended >= 1, `ended=${ended}`);
  assert("and stops itself", !player.playing);
  assert("the duration comes from the element", player.getDuration(214) === 214, `${player.getDuration(0)}s`);

  /* ---- routes ---- */

  section("Routes (jsdom render)");
  const { default: App } = await import("../src/App");

  const routes: [string, string][] = [
    ["/", "Most played nasheeds"],
    ["/search", "Every nasheed"],
    ["/search?q=hijaz", "Matching"],
    ["/library", "Library"],
    ["/queue", "The queue"],
    ["/about", "A streaming home for nasheeds"],
    ["/c/col_fajr", "Before Dawn"],
    ["/c/does-not-exist", "does not exist"],
    ["/a/test.reciter", "Test Reciter"],
    ["/a/test.ensemble", "Test Ensemble"],
    ["/t/sng_fajr", "City of Fajr"],
    ["/t/sng_sakina", "Sakīna"],
    ["/t/nope", "No such nasheed"],
    ["/p/missing", "That set is gone"],
    ["/somewhere-else", "not in the catalogue"],
  ];

  const container = w.document.createElement("div");
  w.document.body.appendChild(container);

  for (const [route, expect] of routes) {
    w.history.pushState({}, "", route);
    const root = createRoot(container);
    let error: unknown = null;
    try {
      await React.act(async () => {
        root.render(React.createElement(App));
      });
      await sleep(30);
    } catch (e) {
      error = e;
    }
    const html = container.innerHTML;
    assert(`${route} renders`, !error && html.length > 800, error ? String(error).slice(0, 160) : `${html.length} chars`);
    assert(
      `${route} contains “${expect}”`,
      html.includes(expect),
      html.includes(expect) ? "" : html.slice(0, 120).replace(/\s+/g, " "),
    );
    try {
      await React.act(async () => {
        root.unmount();
      });
    } catch {
      /* ignore unmount noise */
    }
  }

  /* ---- the lyric view ---- */

  section("Lyrics view");
  {
    const { Lyrics } = await import("../src/components/player/Lyrics");
    const { usePlayer: usePlayerStore } = await import("../src/store/player");
    const lyrics = timedLyrics("sng_sakina", catalog.getTrack("sng_sakina")!.lines, 268);
    const host = w.document.createElement("div");
    w.document.body.appendChild(host);
    const lyrRoot = createRoot(host);
    await React.act(async () => {
      lyrRoot.render(React.createElement(Lyrics, { lyrics, variant: "immersive" }));
    });
    await sleep(80);

    const rendered = host.querySelectorAll(".lyric-line");
    assert("every line is rendered", rendered.length === lyrics.lines.length, `${rendered.length} of ${lyrics.lines.length}`);
    const words = host.querySelectorAll(".lyric-word");
    assert("per-word karaoke spans exist", words.length > 8, `${words.length} words`);
    const fill = host.querySelectorAll(".lyric-word .fill");
    assert("each word has its fill layer", fill.length === words.length);
    const text = host.textContent ?? "";
    assert("script switcher is present", text.includes("Transliteration") && text.includes("العربية"));
    const jumps = host.querySelectorAll('button[aria-label^="Jump to line"]').length;
    assert("the rail offers one jump per line", jumps === lyrics.lines.length, `${jumps} jumps`);

    const railJump = host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Jump to line"]')[2];
    if (railJump) {
      await React.act(async () => {
        usePlayerStore.getState().playTrack("sng_sakina");
      });
      await sleep(60);
      const target = lyrics.lines[2]!.t;
      await React.act(async () => {
        railJump.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      });
      await sleep(60);
      const after = usePlayerStore.getState().time;
      assert("jumping from the rail seeks the recording", Math.abs(after - target) < 2, `seeked to ${after.toFixed(1)}s for a line at ${target.toFixed(1)}s`);
    }

    await React.act(async () => {
      lyrRoot.unmount();
    });
    host.remove();
  }

  /* ---- persistence ---- */

  section("Persistence (a reload from localStorage)");
  {
    const { useLibrary } = await import("../src/store/library");
    const key = "coolnasheed:library:v2";
    const payload = {
      state: {
        liked: ["sng_sakina", "a-track-that-no-longer-exists"],
        likedCollections: ["col_fajr"],
        followedArtists: ["test.reciter"],
        playlists: [
          {
            id: "pl-seeded",
            name: "Fajr set",
            blurb: "Seeded by the test.",
            seed: "playlist-seeded",
            trackIds: ["sng_fajr", "also-gone"],
            createdAt: 1700000000000,
          },
        ],
        history: [{ id: "sng_laylat", at: Date.now(), count: 3 }],
        tasbih: { id: "istighfar", count: 41 },
        // deliberately missing reduceMotion + showTranslation: an older save
        settings: { theme: "dawn", volume: 0.6, lyricScript: "ar", showArabic: false },
      },
      version: 0,
    };
    w.localStorage.setItem(key, JSON.stringify(payload));
    await React.act(async () => {
      useLibrary.persist.rehydrate();
    });
    const st = useLibrary.getState();

    // the library belongs to the account now: localStorage keeps preferences and the
    // tasbīḥ, and nothing that a server could disagree with
    assert("loved nasheeds are not read from localStorage any more", st.liked.length === 0, `liked=${JSON.stringify(st.liked)}`);
    assert("playlists wait for the account that owns them", st.playlists.length === 0);
    assert("followed publishers wait for the account too", st.followedArtists.length === 0);
    assert(
      "the local history mirror comes back until the server's copy lands",
      st.history.some((h) => h.id === "sng_laylat" && h.count === 3),
    );
    assert("the tasbīḥ keeps its count and phrase", st.tasbih.count === 41 && st.tasbih.id === "istighfar");
    assert("preferences come back — theme, script, volume", st.settings.theme === "dawn" && st.settings.lyricScript === "ar" && Math.abs(st.settings.volume - 0.6) < 1e-9);
    assert(
      "keys an older save never had fall back to defaults",
      st.settings.reduceMotion === false && st.settings.showTranslation === true,
      `reduceMotion=${String(st.settings.reduceMotion)} showTranslation=${String(st.settings.showTranslation)}`,
    );

    /* a stale save must degrade, not crash */
    w.history.pushState({}, "", "/library");
    const host = w.document.createElement("div");
    w.document.body.appendChild(host);
    const libRoot = createRoot(host);
    await React.act(async () => {
      libRoot.render(React.createElement(App));
    });
    await sleep(80);
    const text = host.textContent ?? "";
    assert("the library still renders around a stale save", text.includes("Library") || text.includes("library"));
    assert("and the dead id is never rendered", !text.includes("a-track-that-no-longer-exists"));
    await React.act(async () => {
      libRoot.unmount();
    });
    host.remove();

    /* put the store back to defaults so later sections test the normal path */
    w.localStorage.removeItem(key);
    await React.act(async () => {
      useLibrary.persist.rehydrate();
      useLibrary.setState({
        liked: [],
        playlists: [],
        history: [],
        tasbih: { id: "subhanallah", count: 0 },
        settings: { ...useLibrary.getState().settings, theme: "night" },
      });
    });
  }

  section("The gate (writing needs an account, listening does not)");
  {
    const { useLibrary } = await import("../src/store/library");
    const { useUi } = await import("../src/store/ui");

    await React.act(async () => {
      useUi.setState({ authOpen: false });
    });

    const refused = useLibrary.getState().toggleLike("sng_sakina");
    assert("loving a nasheed while signed out is refused", refused === null, `returned ${String(refused)}`);
    assert("and it opens the sign-in sheet instead", useUi.getState().authOpen === true);
    assert("nothing was written to the store", useLibrary.getState().liked.length === 0);

    await React.act(async () => {
      useUi.setState({ authOpen: false });
    });
    const refusedSet = await useLibrary.getState().createPlaylist("Fajr set", ["sng_fajr"]);
    assert("building a set while signed out is refused", refusedSet === null);
    assert("and asks for an account", useUi.getState().authOpen === true);

    await React.act(async () => {
      useUi.setState({ authOpen: false });
    });
  }

  section("Interaction");
  w.history.pushState({}, "", "/");
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(App));
  });
  await sleep(60);

  const playButtons = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Play"], button[aria-label^="Pause"]');
  assert("play controls are present", playButtons.length > 2, `${playButtons.length} found`);

  const firstPlay = Array.from(playButtons).find((b) => b.getAttribute("aria-label")?.startsWith("Play"));
  if (firstPlay) {
    const before = mediaPlayCalls;
    await React.act(async () => {
      firstPlay.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    });
    await sleep(200);
    assert("clicking play starts the player", player.playing || mediaPlayCalls > before, `playing=${player.playing}`);
  }

  const starButtons = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Love"], button[aria-label^="Remove from loved"]');
  assert("love buttons are present", starButtons.length > 0, `${starButtons.length} found`);
  if (starButtons[0]) {
    const { useLibrary } = await import("../src/store/library");
    const { useUi } = await import("../src/store/ui");
    await React.act(async () => {
      useUi.setState({ authOpen: false });
      starButtons[0]!.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    });
    await sleep(40);
    assert("a love tap in the page reaches the gate", useUi.getState().authOpen === true);
    assert("and writes nothing without an account", useLibrary.getState().liked.length === 0);
    await React.act(async () => {
      useUi.setState({ authOpen: false });
    });
  }

  const tasbih = container.querySelector<HTMLButtonElement>('button[aria-label^="Tasbīḥ"]');
  assert("the tasbīḥ counter is in the sidebar", !!tasbih);
  if (tasbih) {
    await React.act(async () => {
      tasbih.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    });
    const { useLibrary } = await import("../src/store/library");
    assert("tasbīḥ counts up", useLibrary.getState().tasbih.count >= 1);
  }

  await React.act(async () => {
    root.unmount();
  });

  const realErrors = consoleErrors.filter(
    (e) => !e.includes("act(") && !e.includes("ReactDOMTestUtils") && !e.includes("wrapped into act"),
  );
  assert("no console.error noise", realErrors.length === 0, realErrors.slice(0, 2).join(" | ").slice(0, 220));

  /* ---- output ---- */

  console.log(notes.join("\n"));
  if (failures.length) {
    console.log(`\nFAILURES (${failures.length}):`);
    console.log(failures.join("\n"));
    process.exit(1);
  }
  console.log(
    `\nAll checks passed — ${catalog.TRACKS.length} nasheeds hydrated, ${timed.lines.length + spread.lines.length} timed lyric lines, ${mediaPlayCalls} play() calls on the element.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("smoke test crashed:", e);
  process.exit(1);
});
