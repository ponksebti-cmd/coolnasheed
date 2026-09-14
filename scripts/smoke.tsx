/**
 * Headless smoke test.
 *
 * Bundled with esbuild and run under jsdom, so the whole app — data, composer,
 * audio graph, every route — is exercised without a browser. Run with:
 *
 *   npm run smoke
 *
 * It validates the catalogue, the generated songs (timings, words, frequencies),
 * the Web Audio engine against a fake context, and server-renders each route.
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

/* ------------------------------------------------------------- fake audio */

let nodeCount = 0;
let startedSources = 0;
let buffersPlayed = 0;

class FakeParam {
  value = 0;
  private calls = 0;
  setValueAtTime(v: number) {
    if (!Number.isFinite(v)) throw new Error("setValueAtTime got a non-finite value");
    this.value = v;
    this.calls++;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    if (!Number.isFinite(v) || !Number.isFinite(t) || t < 0) throw new Error(`bad linearRamp ${v}@${t}`);
    this.value = v;
    this.calls++;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (!Number.isFinite(v) || v === 0 || !Number.isFinite(t) || t < 0) throw new Error(`bad exponentialRamp ${v}@${t}`);
    this.value = v;
    this.calls++;
    return this;
  }
  setTargetAtTime(v: number, t: number, c: number) {
    if (!Number.isFinite(v) || !Number.isFinite(t) || !Number.isFinite(c)) throw new Error("bad setTargetAtTime");
    this.value = v;
    this.calls++;
    return this;
  }
  cancelScheduledValues(t: number) {
    if (!Number.isFinite(t)) throw new Error("bad cancelScheduledValues");
    this.calls++;
    return this;
  }
  get automationCalls() {
    return this.calls;
  }
}

/** Every node the engine builds, kept so tests can inspect the graph itself. */
const liveNodes: FakeNode[] = [];

class FakeNode {
  context: FakeAudioContext;
  numberOfInputs = 1;
  numberOfOutputs = 1;
  constructor(ctx: FakeAudioContext) {
    this.context = ctx;
    nodeCount++;
    liveNodes.push(this);
  }
  connect(dest: unknown) {
    if (!dest) throw new Error("connect() called with no destination");
    return dest as FakeNode;
  }
  disconnect() {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}
class FakeFilter extends FakeNode {
  type = "lowpass";
  frequency = new FakeParam();
  Q = new FakeParam();
  detune = new FakeParam();
  gain = new FakeParam();
}
class FakePanner extends FakeNode {
  pan = new FakeParam();
}
class FakeOsc extends FakeNode {
  type = "sine";
  frequency = new FakeParam();
  detune = new FakeParam();
  onended: (() => void) | null = null;
  private started = false;
  private stopped = false;
  start(when = 0) {
    if (this.started) throw new Error("oscillator started twice");
    if (!Number.isFinite(when) || when < 0) throw new Error(`bad start time ${when}`);
    this.started = true;
    startedSources++;
  }
  stop(when = 0) {
    if (!this.started) throw new Error("stop before start");
    if (!Number.isFinite(when) || when < 0) throw new Error(`bad stop time ${when}`);
    this.stopped = true;
  }
  get wasStopped() {
    return this.stopped;
  }
}
class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  playbackRate = new FakeParam();
  detune = new FakeParam();
  loop = false;
  onended: (() => void) | null = null;
  private started = false;
  start(when = 0) {
    if (this.started) throw new Error("buffer source started twice");
    if (!Number.isFinite(when) || when < 0) throw new Error(`bad start time ${when}`);
    this.started = true;
    startedSources++;
    buffersPlayed++;
  }
  stop(when = 0) {
    if (!Number.isFinite(when) || when < 0) throw new Error(`bad stop time ${when}`);
  }
}
class FakeBuffer {
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  private data: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(i: number) {
    return this.data[i]!;
  }
}
class FakeConvolver extends FakeNode {
  buffer: FakeBuffer | null = null;
  normalize = true;
}
class FakeCompressor extends FakeNode {
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  reduction = 0;
}
class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  getByteFrequencyData(arr: Uint8Array) {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(120 + 60 * Math.sin(i / 7));
  }
  getByteTimeDomainData(arr: Uint8Array) {
    arr.fill(128);
  }
}

class FakeAudioContext {
  private t0 = Date.now();
  sampleRate = 48000;
  state: "running" | "suspended" = "running";
  destination = new FakeNode(this);
  onstatechange: (() => void) | null = null;
  get currentTime() {
    return (Date.now() - this.t0) / 1000;
  }
  createGain() {
    return new FakeGain(this);
  }
  createBiquadFilter() {
    return new FakeFilter(this);
  }
  createStereoPanner() {
    return new FakePanner(this);
  }
  createOscillator() {
    return new FakeOsc(this);
  }
  createBufferSource() {
    return new FakeBufferSource(this);
  }
  createConvolver() {
    return new FakeConvolver(this);
  }
  createDynamicsCompressor() {
    return new FakeCompressor(this);
  }
  createAnalyser() {
    return new FakeAnalyser(this);
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length, sampleRate);
  }
  async resume() {
    this.state = "running";
  }
  async suspend() {
    this.state = "suspended";
  }
  async close() {
    this.state = "suspended";
  }
}

/* -------------------------------------------------------------- jsdom host */

const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="root"></div></body></html>`, {
  url: "http://localhost:5173/",
  pretendToBeVisual: true,
  virtualConsole: quietConsole,
});

const w = dom.window as unknown as Record<string, unknown> & typeof dom.window;
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

  /* ---- catalogue + composer ---- */
  const catalog = await import("../src/data/catalog");
  const { songFor } = await import("../src/lib/song");
  const theory = await import("../src/lib/theory");

  section("Catalogue");
  assert(`${catalog.TRACKS.length} tracks loaded`, catalog.TRACKS.length >= 20);
  assert(`${catalog.ARTISTS.length} reciters loaded`, catalog.ARTISTS.length >= 6);
  assert(`${catalog.COLLECTIONS.length} sets loaded`, catalog.COLLECTIONS.length >= 6);

  const badArtist = catalog.TRACKS.filter((t) => !catalog.getArtist(t.artistId));
  assert("every track has a real reciter", badArtist.length === 0, badArtist.map((t) => t.id).join(","));

  const orphanTracks = catalog.COLLECTIONS.flatMap((c) => c.trackIds).filter((id) => !catalog.getTrack(id));
  assert("every set points at real tracks", orphanTracks.length === 0, orphanTracks.join(","));

  const uncollected = catalog.TRACKS.filter((t) => !catalog.COLLECTIONS.some((c) => c.trackIds.includes(t.id)));
  assert("every track appears in at least one set", uncollected.length === 0, uncollected.map((t) => t.id).join(","));

  const dupes = catalog.TRACKS.map((t) => t.id).filter((id, i, arr) => arr.indexOf(id) !== i);
  assert("track ids are unique", dupes.length === 0, dupes.join(","));

  section("Composer (song builder)");
  let minDur = Infinity;
  let maxDur = 0;
  let totalNotes = 0;
  let totalHits = 0;
  let totalLines = 0;
  const problems: string[] = [];

  catalog.TRACKS.forEach((track) => {
    const song = songFor(track);
    totalNotes += song.notes.length;
    totalHits += song.duff.length;
    totalLines += song.lines.length;
    minDur = Math.min(minDur, song.duration);
    maxDur = Math.max(maxDur, song.duration);

    const expectedLines = track.lines.length * Math.max(1, track.passes ?? 2);
    if (song.lines.length !== expectedLines)
      problems.push(`${track.id}: expected ${expectedLines} timed lines, got ${song.lines.length}`);
    if (!Number.isFinite(song.duration) || song.duration <= 0) problems.push(`${track.id}: bad duration`);
    song.notes.forEach((n, i) => {
      if (!Number.isFinite(n.freq) || n.freq <= 20 || n.freq > 6000) problems.push(`${track.id}: note ${i} freq ${n.freq}`);
      if (!Number.isFinite(n.t) || n.t < 0) problems.push(`${track.id}: note ${i} time ${n.t}`);
      if (!Number.isFinite(n.dur) || n.dur <= 0) problems.push(`${track.id}: note ${i} dur ${n.dur}`);
    });
    song.duff.forEach((d, i) => {
      if (!Number.isFinite(d.t) || d.t < 0 || d.t > song.duration + 0.5) problems.push(`${track.id}: duff ${i} at ${d.t}`);
    });
    song.lines.forEach((l, i) => {
      if (l.words.length === 0) problems.push(`${track.id}: line ${i} has no words`);
      if (l.end <= l.t) problems.push(`${track.id}: line ${i} ends before it starts`);
      if (i > 0 && l.t < song.lines[i - 1]!.end - 0.001) problems.push(`${track.id}: line ${i} overlaps the previous`);
      let prevEnd = -1;
      l.words.forEach((wd) => {
        if (wd.t < l.t - 0.001 || wd.end > l.end + 0.001) problems.push(`${track.id}: word "${wd.text}" outside its line`);
        if (wd.t < prevEnd - 0.001) problems.push(`${track.id}: word "${wd.text}" goes backwards`);
        if (!wd.text.trim()) problems.push(`${track.id}: empty word`);
        prevEnd = wd.end;
      });
    });
  });

  assert("every song is finite and non-empty", problems.length === 0, problems.slice(0, 4).join(" | "));
  assert(
    `durations between 40s and 5m`,
    minDur >= 40 && maxDur <= 300,
    `min ${minDur.toFixed(1)}s, max ${maxDur.toFixed(1)}s`,
  );
  assert(`${totalNotes} notes scheduled`, totalNotes > 500);
  assert(`${totalHits} duff hits scheduled`, totalHits > 100);
  const expectedTotal = catalog.TRACKS.reduce((n, t) => n + t.lines.length * Math.max(1, t.passes ?? 2), 0);
  assert(
    `${totalLines} timed lyric lines across all repetitions`,
    totalLines === expectedTotal,
    `expected ${expectedTotal}`,
  );

  notes.push(
    catalog.TRACKS.map((t) => {
      const sg = songFor(t);
      return `    ${t.id.padEnd(26)} ${sg.duration.toFixed(0).padStart(3)}s  ${String(sg.notes.length).padStart(4)} notes  ${String(sg.duff.length).padStart(4)} hits  ${String(sg.lines.length).padStart(2)} lines  ${t.maqam}/${t.bpm}bpm/${t.voices}`;
    }).join("\n"),
  );

  section("Maqām theory");
  const hijaz = theory.degreeToFreq(57, "hijaz", 2);
  const tonic = theory.degreeToFreq(57, "hijaz", 0);
  assert("degree 2 in Ḥijāz is a major third up", Math.abs(hijaz / tonic - Math.pow(2, 4 / 12)) < 1e-6);
  assert("octave wraps", Math.abs(theory.degreeToFreq(57, "hijaz", 7) / tonic - 2) < 1e-6);
  assert("negative degrees wrap down", Math.abs(theory.degreeToFreq(57, "hijaz", -7) / tonic - 0.5) < 1e-6);
  const rastThird = theory.degreeToFreq(60, "rast", 2) / theory.degreeToFreq(60, "rast", 0);
  assert("Rāst keeps its quarter tone", Math.abs(rastThird - Math.pow(2, 3.5 / 12)) < 1e-6, `${rastThird.toFixed(4)} ratio`);
  assert("note names resolve", theory.noteName(60) === "C4", theory.noteName(60));

  section("Syllabifier");
  const latin = theory.syllabifyLine("Mawlāya ṣalli wa sallim dāʾiman abadā", undefined);
  assert("transliteration splits into words", latin.words.length === 6, `${latin.words.length}: ${latin.words.join(" ")}`);
  assert("and into more syllables than words", latin.syllables.length > latin.words.length, `${latin.syllables.length} syllables`);
  assert("vowels are extracted", latin.syllables.every((s) => "aeioum".includes(s.vowel)));
  const arabic = theory.syllabifyLine(undefined, "طَلَعَ البَدْرُ عَلَيْنَا");
  assert("Arabic-only lines syllabify", arabic.syllables.length >= 4, `${arabic.syllables.length} syllables`);
  const english = theory.syllabifyLine("The full moon rose upon us", undefined);
  assert("English lines syllabify", english.syllables.length >= 6, `${english.syllables.length} syllables`);

  section("Search & curator");
  assert("title search", catalog.searchTracks("badru").length > 0);
  assert("lyric-line search", catalog.searchTracks("gratitude").length > 0);
  assert("artist search", catalog.searchArtists("cairo").length > 0);
  assert("maqām search", catalog.searchTracks("hijaz").length > 0);
  assert("nonsense search returns nothing", catalog.searchTracks("zzzqqq").length === 0);

  const { generateNurMix, buildTaste } = await import("../src/lib/nur");
  const emptyMix = generateNurMix({ liked: [], history: [], size: 8, seedKey: "smoke-a" });
  assert("Nūr builds a mix from nothing", emptyMix.trackIds.length === 8);
  assert("Nūr mix has no duplicate tracks", new Set(emptyMix.trackIds).size === emptyMix.trackIds.length);
  assert("every pick has a reason", emptyMix.picks.every((p) => p.reason.length > 12));
  const deterministic = generateNurMix({ liked: [], history: [], size: 8, seedKey: "smoke-a" });
  assert("same seed, same mix", deterministic.trackIds.join() === emptyMix.trackIds.join());
  const taste = buildTaste(["talaa-al-badru", "sakina"], [{ id: "la-ilaha-illa-allah", at: Date.now(), count: 3 }]);
  assert("taste vector learns tags", Object.keys(taste.tags).length > 0);
  const seededMix = generateNurMix({ liked: ["sakina", "dust-and-light", "ya-rabb"], history: [], size: 8, seedKey: "smoke-b", moodId: "still" });
  assert("mood-constrained mix still fills up", seededMix.trackIds.length === 8);
  assert("taste shifts the picks", seededMix.trackIds.join() !== emptyMix.trackIds.join());

  /* ---- audio engine ---- */
  section("Audio engine (fake context)");
  const { engine } = await import("../src/lib/audio/engine");
  const target = catalog.getTrack("talaa-al-badru")!;
  const song = songFor(target);
  let ended = 0;
  engine.handlers.onEnded = () => {
    ended++;
  };
  await engine.load(song, 0);
  assert("loaded at t=0", Math.abs(engine.getTime()) < 0.01);
  await engine.play();
  assert("playing after play()", engine.isPlaying);
  await sleep(420);
  const advanced = engine.getTime();
  assert("the clock advances", advanced > 0.05, `${advanced.toFixed(2)}s`);
  assert("sources were scheduled", startedSources > 4, `${startedSources} started, ${nodeCount} nodes built`);
  const spectrum = engine.readSpectrum();
  assert("analyser spectrum is readable", spectrum.length > 0 && spectrum[0] !== undefined);
  assert("level meter reads", engine.readLevel() >= 0 && engine.readLevel() <= 1);

  /* The intro is one long hum drone, so jump into a sung verse and let the
     scheduler run through a few phrases before inspecting what it built. */
  await engine.seek(song.lines[2]!.t + 0.05);
  await sleep(1600);

  /* ---- white-box: inspect the graph the engine actually built ---- */
  const { FORMANTS } = await import("../src/lib/voice-types");
  const gains = liveNodes.filter((n): n is FakeGain => n instanceof FakeGain);
  const saws = liveNodes.filter((n): n is FakeOsc => n instanceof FakeOsc && n.type === "sawtooth");
  const bandpass = liveNodes.filter((n): n is FakeFilter => n instanceof FakeFilter && n.type === "bandpass");
  const convs = liveNodes.filter((n): n is FakeConvolver => n instanceof FakeConvolver);

  assert("voices are sawtooth sources, not sine beeps", saws.length >= 12, `${saws.length} sawtooth oscillators`);
  assert(
    "every voice is shaped by three formant resonators",
    bandpass.length >= saws.length,
    `${bandpass.length} band-passes for ${saws.length} saws`,
  );

  const bpFreqs = new Set(bandpass.map((b) => Math.round(b.frequency.value)));
  const vowelsUsed = Object.entries(FORMANTS)
    .map(([v, cfg]) => ({ v, hits: cfg.f.filter((f) => bpFreqs.has(Math.round(f))).length }))
    .filter((x) => x.hits >= 2);
  assert(
    "their frequencies come from the vowel table",
    vowelsUsed.length >= 2,
    vowelsUsed.map((x) => `${x.v} ${x.hits}/3`).join(", "),
  );

  assert("one convolver carries the whole mix", convs.length === 1, `${convs.length} convolvers`);
  const irBefore = convs[0]?.buffer?.duration ?? 0;
  engine.setSpace("masjid");
  const irAfter = convs[0]?.buffer?.duration ?? 0;
  assert(
    "changing space rebuilds a longer impulse response",
    irAfter > irBefore + 1,
    `${irBefore.toFixed(2)}s → ${irAfter.toFixed(2)}s`,
  );
  assert("and the engine reports the new space", engine.currentSpace === "masjid");

  /* Identify buses by what moves, not by guessing values. */
  const beforeVolume = gains.map((g) => g.gain.value);
  engine.setVolume(4);
  const master = gains.filter((g, i) => g.gain.value !== beforeVolume[i]);
  assert(
    "out-of-range volume is clamped onto exactly one bus",
    master.length === 1 && master[0]!.gain.value === 1,
    `${master.length} bus(es) moved, value ${master[0]?.gain.value}`,
  );
  engine.setVolume(0.4);
  assert("0.4 reaches the same master bus", Math.abs(master[0]!.gain.value - 0.4) < 1e-9);

  const beforeDuff = gains.map((g) => g.gain.value);
  engine.setDuff(false);
  const drumBus = gains.filter((g, i) => g.gain.value !== beforeDuff[i]);
  assert(
    "duff off silences one bus and leaves the voices alone",
    drumBus.length === 1 && drumBus[0]!.gain.value === 0 && Math.abs(master[0]!.gain.value - 0.4) < 1e-9,
    `${drumBus.length} bus(es) moved`,
  );
  assert("the engine remembers the choice", engine.duffEnabled === false);
  engine.setDuff(true);
  assert("duff on restores that bus to 0.5", Math.abs(drumBus[0]!.gain.value - 0.5) < 1e-9);
  assert("and reports it", engine.duffEnabled === true);

  await engine.seek(2);
  assert("seek lands near the target", Math.abs(engine.getTime() - 2) < 0.4, engine.getTime().toFixed(2));

  engine.pause();
  assert("paused", !engine.isPlaying);
  const pausedAt = engine.getTime();
  await sleep(120);
  assert("the clock holds while paused", Math.abs(engine.getTime() - pausedAt) < 0.05);

  await engine.seek(song.duration - 0.25);
  await engine.play();
  await sleep(600);
  assert("reaches the end and fires onEnded", ended >= 1, `ended=${ended}`);
  assert("engine stopped itself", !engine.isPlaying);

  // a second track, to be sure the graph survives a rebuild
  const second = songFor(catalog.getTrack("sakina")!);
  await engine.load(second, 0);
  await engine.play();
  await sleep(260);
  assert("a second track plays after the first finished", engine.isPlaying && engine.getTime() > 0.05);
  engine.stop();
  assert("stop resets the clock", engine.getTime() === 0);

  /* ---- routes ---- */
  section("Routes (jsdom render)");
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { default: App } = await import("../src/App");

  const routes: [string, string][] = [
    ["/", "Most played nasheeds"],
    ["/search", "Every nasheed"],
    ["/search?q=hijaz", "Matching"],
    ["/search?mood=still", "Stillness"],
    ["/library", "Library"],
    ["/queue", "The queue"],
    ["/about", "A streaming app for nasheeds"],
    ["/c/nur", "Nūr"],
    ["/c/ramadan-nights", "Ramadan"],
    ["/c/does-not-exist", "does not exist"],
    ["/a/yusuf", "Yusuf Karim"],
    ["/a/halabi", "Ḥalabī"],
    ["/t/talaa-al-badru", "Ṭalaʿa al-Badru"],
    ["/t/sakina", "Sakīna"],
    ["/t/nur-ala-nur", "Nūrun"],
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
    assert(`${route} contains “${expect}”`, html.includes(expect), html.includes(expect) ? "" : html.slice(0, 90).replace(/\s+/g, " "));
    try {
      await React.act(async () => {
        root.unmount();
      });
    } catch {
      /* ignore unmount noise */
    }
  }

  /* ---- interactions ---- */
  section("Lyrics view");
  {
    const { Lyrics } = await import("../src/components/player/Lyrics");
    const { usePlayer: usePlayerStore } = await import("../src/store/player");
    const song = songFor(catalog.TRACKS.find((t) => t.id === "sakina")!);
    const host = w.document.createElement("div");
    w.document.body.appendChild(host);
    const lyrRoot = createRoot(host);
    await React.act(async () => {
      lyrRoot.render(React.createElement(Lyrics, { song, variant: "immersive" }));
    });
    await sleep(80);

    const rendered = host.querySelectorAll(".lyric-line");
    assert(
      "every timed line is rendered",
      rendered.length === song.lines.length,
      `${rendered.length} of ${song.lines.length}`,
    );
    const karaoke = host.querySelectorAll(".lyric-word");
    assert("per-word karaoke spans exist", karaoke.length > 30, `${karaoke.length} words`);
    const fill = host.querySelectorAll(".lyric-word .fill");
    assert("each word has its fill layer", fill.length === karaoke.length);
    const text = host.textContent ?? "";
    assert("repetitions are labelled, not duplicated", text.includes("the answer — a step higher"), "pass divider");
    assert("script switcher is present", text.includes("Transliteration") && text.includes("العربية"));
    assert("the rail offers one jump per line", host.querySelectorAll('button[aria-label^="Jump to line"]').length === song.lines.length);

    const railJump = host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Jump to line"]')[5];
    if (railJump) {
      await React.act(async () => {
        usePlayerStore.getState().playTrack(song.trackId);
      });
      await sleep(150);
      const target = song.lines[5]!.t;
      await React.act(async () => {
        railJump.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      });
      const after = usePlayerStore.getState().time;
      assert(
        "jumping from the rail seeks the song",
        Math.abs(after - target) < 2,
        `seeked to ${after.toFixed(1)}s for a line at ${target.toFixed(1)}s`,
      );
    }

    await React.act(async () => {
      lyrRoot.unmount();
    });
    host.remove();
  }

  section("Persistence (a reload from localStorage)");
  {
    const { useLibrary } = await import("../src/store/library");
    const key = "coolnasheed:library:v1";
    const payload = {
      state: {
        liked: ["sakina", "a-track-that-no-longer-exists"],
        likedCollections: ["nur"],
        followedArtists: ["yusuf"],
        playlists: [
          {
            id: "pl-seeded",
            name: "Fajr set",
            blurb: "Seeded by the test.",
            seed: "playlist-seeded",
            accent: "jade",
            trackIds: ["city-of-fajr", "also-gone"],
            createdAt: 1700000000000,
          },
        ],
        history: [{ id: "laylat-al-qadr", at: Date.now(), count: 3 }],
        tasbih: { id: "istighfar", count: 41 },
        // deliberately missing reduceMotion + showTranslation: an older save
        settings: { theme: "dawn", space: "masjid", duff: false, volume: 0.6, lyricScript: "ar", showArabic: false },
      },
      version: 0,
    };
    w.localStorage.setItem(key, JSON.stringify(payload));
    await React.act(async () => {
      useLibrary.persist.rehydrate();
    });
    const st = useLibrary.getState();

    assert("loved nasheeds come back", st.liked.includes("sakina"));
    assert("playlists come back with their tracks", st.playlists.some((p) => p.id === "pl-seeded" && p.trackIds.includes("city-of-fajr")));
    assert("followed reciters come back", st.followedArtists.includes("yusuf"));
    assert("the tasbīḥ keeps its count and phrase", st.tasbih.count === 41 && st.tasbih.id === "istighfar");
    assert("play history comes back", st.history.some((h) => h.id === "laylat-al-qadr" && h.count === 3));
    assert(
      "preferences come back — theme, room, duff, script",
      st.settings.theme === "dawn" && st.settings.space === "masjid" && st.settings.duff === false && st.settings.lyricScript === "ar",
    );
    assert(
      "keys an older save never had fall back to defaults",
      st.settings.reduceMotion === false && st.settings.showTranslation === true,
      `reduceMotion=${String(st.settings.reduceMotion)} showTranslation=${String(st.settings.showTranslation)}`,
    );

    /* stale ids must degrade, not crash */
    w.history.pushState({}, "", "/library");
    const host = w.document.createElement("div");
    w.document.body.appendChild(host);
    const libRoot = createRoot(host);
    await React.act(async () => {
      libRoot.render(React.createElement(App));
    });
    await sleep(80);
    const text = host.textContent ?? "";
    assert("the library still renders around a stale id", text.includes("Fajr set"), "playlist shown");
    assert("and the dead id is never rendered", !text.includes("a-track-that-no-longer-exists"));
    await React.act(async () => {
      libRoot.unmount();
    });
    host.remove();

    /* put the store back to defaults so later sections test the normal path */
    w.localStorage.removeItem(key);
    await React.act(async () => {
      useLibrary.persist.rehydrate();
      useLibrary.setState({ liked: [], playlists: [], history: [], tasbih: { id: "subhanallah", count: 0 } });
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
    await React.act(async () => {
      firstPlay.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    });
    await sleep(200);
    assert("clicking play starts the engine", engine.isPlaying || engine.isReady);
  }

  const starButtons = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Love"], button[aria-label^="Remove from loved"]');
  assert("love buttons are present", starButtons.length > 0, `${starButtons.length} found`);
  if (starButtons[0]) {
    await React.act(async () => {
      starButtons[0]!.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    });
    const { useLibrary } = await import("../src/store/library");
    assert("loving a track persists to the store", useLibrary.getState().liked.length > 0);
    assert("and to localStorage", (w.localStorage.getItem("coolnasheed:library:v1") ?? "").includes("liked"));
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
  console.log(`\nAll checks passed — ${totalNotes} notes, ${totalHits} drum hits, ${nodeCount} audio nodes built during the run.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("smoke test crashed:", e);
  process.exit(1);
});
