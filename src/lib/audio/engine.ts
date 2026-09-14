/**
 * The performance engine.
 *
 * Nasheeds are sung, not played — so instead of shipping audio files this app
 * synthesizes them live with the Web Audio API:
 *
 *   • lead voice   — detuned sawtooth "glottis" → 3 parallel formant band-passes
 *                    (vowels come from the actual lyric syllables), vibrato, portamento
 *   • harmony      — softer "ooh" voices panned wide, a third/fifth below the lead
 *   • hum drone    — closed-lip tonic + fifth bed under each phrase
 *   • duff         — frame-drum dum/tak from filtered noise + a pitch-dropping thump
 *   • space        — procedural convolution reverb (studio / room / hall / masjid)
 *
 * Everything is scheduled with a rolling look-ahead clock, so seeking, pausing and
 * volume changes stay sample-accurate and the lyric timings never drift.
 */

import { FORMANTS } from "../voice-types";
import type { DuffEvent, NoteEvent, NoteRole, Song } from "../song";
import { clamp, rngFrom } from "../prng";

export type SpacePreset = "studio" | "room" | "hall" | "masjid";

const SPACES: Record<SpacePreset, { seconds: number; decay: number; wet: number; label: string }> = {
  studio: { seconds: 0.5, decay: 3.4, wet: 0.14, label: "Studio" },
  room: { seconds: 1.5, decay: 2.6, wet: 0.3, label: "Room" },
  hall: { seconds: 3.1, decay: 2.2, wet: 0.46, label: "Hall" },
  masjid: { seconds: 4.6, decay: 1.7, wet: 0.62, label: "Masjid" },
};

export const SPACE_LABELS = Object.entries(SPACES).map(([id, s]) => ({ id: id as SpacePreset, label: s.label }));

const ROLE_GAIN: Record<NoteRole, number> = { lead: 0.62, harm: 0.4, hum: 0.5 };

export type EngineHandlers = {
  onEnded?: () => void;
  onStateChange?: (playing: boolean) => void;
};

type Tracked = { src: AudioScheduledSourceNode; stopAt: number };

export class NasheedEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private mix: GainNode | null = null;
  private buses: Record<NoteRole, GainNode> | null = null;
  private duffBus: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private wet: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private noise: AudioBuffer | null = null;
  private irs = new Map<SpacePreset, AudioBuffer>();

  private song: Song | null = null;
  /** an uploaded recording replaces the synthesized performance when present */
  private recording: AudioBuffer | null = null;
  private recordingSource: AudioBufferSourceNode | null = null;
  private recordingGain: GainNode | null = null;
  private readonly decoded = new Map<string, AudioBuffer>();
  private noteCursor = 0;
  private duffCursor = 0;
  private startedAt = 0;
  private songTime = 0;
  private playing = false;
  private timer: number | null = null;
  private active = new Set<Tracked>();
  private spectrum: Uint8Array<ArrayBuffer> | null = null;

  private volume = 0.85;
  private duffOn = true;
  private space: SpacePreset = "hall";

  handlers: EngineHandlers = {};

  get isReady(): boolean {
    return !!this.ctx;
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  get currentSong(): Song | null {
    return this.song;
  }
  /** true while an uploaded recording is loaded rather than a synthesized performance */
  get isRecording(): boolean {
    return this.recording !== null;
  }
  /** length of whatever is loaded, in seconds — recording or composition */
  get currentDuration(): number {
    if (this.recording) return this.recording.duration;
    return this.song?.duration ?? 0;
  }

  /* ---------------------------------------------------------------- setup */

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: "interactive" });
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -13;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.22;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;

    comp.connect(master);
    master.connect(analyser);
    analyser.connect(ctx.destination);

    this.master = master;
    this.compressor = comp;
    this.analyser = analyser;

    const convolver = ctx.createConvolver();
    convolver.buffer = this.irFor(this.space);
    const wet = ctx.createGain();
    wet.gain.value = SPACES[this.space].wet;
    convolver.connect(wet);
    wet.connect(comp);
    this.convolver = convolver;
    this.wet = wet;

    ctx.onstatechange = () => {
      if (ctx.state === "suspended" && this.playing) void ctx.resume().catch(() => {});
    };

    this.buildBuses();
    this.noise = makeNoise(ctx, 1.2);
    return ctx;
  }

  private buildBuses() {
    const ctx = this.ctx!;
    const mix = ctx.createGain();
    mix.gain.value = 1;
    mix.connect(this.compressor!);

    const buses = {} as Record<NoteRole, GainNode>;
    (["lead", "harm", "hum"] as NoteRole[]).forEach((role) => {
      const g = ctx.createGain();
      g.gain.value = ROLE_GAIN[role];
      g.connect(mix);
      const send = ctx.createGain();
      send.gain.value = role === "lead" ? 0.34 : role === "harm" ? 0.4 : 0.22;
      g.connect(send);
      send.connect(this.convolver!);
      buses[role] = g;
    });

    const duff = ctx.createGain();
    duff.gain.value = this.duffOn ? 0.5 : 0;
    duff.connect(mix);
    const duffSend = ctx.createGain();
    duffSend.gain.value = 0.16;
    duff.connect(duffSend);
    duffSend.connect(this.convolver!);

    this.mix = mix;
    this.buses = buses;
    this.duffBus = duff;
  }

  private irFor(space: SpacePreset): AudioBuffer {
    const ctx = this.ensureRaw();
    const cached = this.irs.get(space);
    if (cached) return cached;
    const cfg = SPACES[space];
    const ir = createImpulse(ctx, cfg.seconds, cfg.decay);
    this.irs.set(space, ir);
    return ir;
  }

  /** IRs need a context but must not build the whole graph — used during ensure(). */
  private ensureRaw(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: "interactive" });
    return this.ctx;
  }

  /* ------------------------------------------------------- uploaded audio */

  /**
   * Load a recording and route it through the same chain as the synthesized voices, so
   * volume, the space preset and the visualisers all behave identically. Returns the
   * decoded length in seconds, which is the only way to know it before playing.
   */
  async loadRecording(url: string, atTime = 0): Promise<number> {
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});

    let buffer = this.decoded.get(url);
    if (!buffer) {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Could not fetch the recording (${res.status}).`);
      const bytes = await res.arrayBuffer();
      buffer = await ctx.decodeAudioData(bytes);
      this.decoded.set(url, buffer);
    }

    this.stopRecordingSource(0.02);
    this.killVoices(0.02);
    this.song = null; // a recording has no note schedule to run
    this.recording = buffer;
    this.ensureRecordingChain();
    this.songTime = clamp(atTime, 0, Math.max(0, buffer.duration - 0.05));
    return buffer.duration;
  }

  /** The recording path is wired to the compressor and the reverb, both of which
   *  survive `killVoices()` rebuilding the synthesized buses. */
  private ensureRecordingChain() {
    const ctx = this.ensure();
    if (this.recordingGain) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.95;
    gain.connect(this.compressor!);
    const send = ctx.createGain();
    send.gain.value = 0.16;
    gain.connect(send);
    send.connect(this.convolver!);
    this.recordingGain = gain;
  }

  private stopRecordingSource(fade: number) {
    const src = this.recordingSource;
    if (!src || !this.ctx) return;
    this.recordingSource = null;
    try {
      src.stop(this.ctx.currentTime + fade);
    } catch {
      /* already stopped */
    }
    src.onended = null;
  }

  private playRecording(ctx: AudioContext) {
    const buffer = this.recording;
    if (!buffer) return;
    this.ensureRecordingChain();
    if (this.songTime >= buffer.duration - 0.02) this.songTime = 0;
    this.stopRecordingSource(0.01);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.recordingGain!);
    const offset = this.songTime;
    const startAt = ctx.currentTime + 0.02;
    this.startedAt = startAt - offset;
    this.recordingSource = src;

    src.onended = () => {
      if (this.recordingSource !== src) return; // we stopped it ourselves
      this.recordingSource = null;
      this.songTime = buffer.duration;
      this.playing = false;
      this.stopScheduler();
      this.handlers.onStateChange?.(false);
      this.handlers.onEnded?.();
    };

    src.start(startAt, offset);
    this.playing = true;
    this.handlers.onStateChange?.(true);
  }

  /* ------------------------------------------------------------- controls */

  async load(song: Song, atTime = 0) {
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    // switching from a recording back to a synthesized performance
    this.stopRecordingSource(0.02);
    this.recording = null;
    this.song = song;
    this.songTime = clamp(atTime, 0, Math.max(0, song.duration - 0.05));
    this.noteCursor = firstIndexAt(song.notes, this.songTime);
    this.duffCursor = firstIndexAt(song.duff, this.songTime);
    this.killVoices(0.02);
  }

  async play() {
    if (!this.song && !this.recording) return;
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    if (this.recording) {
      this.playRecording(ctx);
      return;
    }
    const song = this.song;
    if (!song) return;
    if (this.songTime >= song.duration - 0.02) {
      this.songTime = 0;
      this.noteCursor = 0;
      this.duffCursor = 0;
    } else {
      this.noteCursor = firstIndexAt(song.notes, this.songTime);
      this.duffCursor = firstIndexAt(song.duff, this.songTime);
    }
    this.killVoices(0.02);
    this.startedAt = ctx.currentTime + 0.06 - this.songTime;
    this.playing = true;
    this.handlers.onStateChange?.(true);
    this.startScheduler();
  }

  pause() {
    if (!this.ctx) return;
    this.songTime = this.getTime();
    this.playing = false;
    this.stopScheduler();
    this.stopRecordingSource(0.04);
    this.killVoices(0.06);
    this.handlers.onStateChange?.(false);
  }

  stop() {
    this.pause();
    this.songTime = 0;
    this.noteCursor = 0;
    this.duffCursor = 0;
  }

  async seek(t: number) {
    if (!this.song && !this.recording) return;
    const target = clamp(t, 0, this.currentDuration);
    if (this.recording) {
      this.songTime = target;
      if (this.playing && this.ctx) this.playRecording(this.ctx);
      return;
    }
    const song = this.song;
    if (!song) return;
    this.songTime = target;
    this.noteCursor = firstIndexAt(song.notes, target);
    this.duffCursor = firstIndexAt(song.duff, target);
    if (this.playing) {
      const ctx = this.ensure();
      this.killVoices(0.02);
      this.startedAt = ctx.currentTime + 0.05 - target;
      this.tick();
    }
  }

  getTime(): number {
    if (!this.song && !this.recording) return 0;
    if (!this.playing || !this.ctx) return this.songTime;
    return clamp(this.ctx.currentTime - this.startedAt, 0, this.currentDuration);
  }

  setVolume(v: number) {
    this.volume = clamp(v, 0, 1);
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  setDuff(on: boolean) {
    this.duffOn = on;
    if (this.duffBus && this.ctx) {
      this.duffBus.gain.cancelScheduledValues(this.ctx.currentTime);
      this.duffBus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.03);
    }
  }

  get duffEnabled(): boolean {
    return this.duffOn;
  }

  setSpace(space: SpacePreset) {
    this.space = space;
    if (!this.convolver || !this.wet || !this.ctx) return;
    this.convolver.buffer = this.irFor(space);
    this.wet.gain.setTargetAtTime(SPACES[space].wet, this.ctx.currentTime, 0.08);
  }

  get currentSpace(): SpacePreset {
    return this.space;
  }

  /** Spectrum magnitudes for visualizers (length = bins). */
  readSpectrum(): Uint8Array<ArrayBuffer> {
    const analyser = this.analyser;
    const bins = analyser ? analyser.frequencyBinCount : 256;
    if (!this.spectrum || this.spectrum.length !== bins) this.spectrum = new Uint8Array(bins);
    if (analyser) analyser.getByteFrequencyData(this.spectrum);
    else this.spectrum.fill(0);
    return this.spectrum;
  }

  /** 0..1 loudness, handy for reactive artwork glow. */
  readLevel(): number {
    const data = this.readSpectrum();
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i]!;
    return clamp(sum / (data.length * 255), 0, 1);
  }

  /* ------------------------------------------------------------ scheduler */

  private startScheduler() {
    this.stopScheduler();
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
  }

  private stopScheduler() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    const ctx = this.ctx;
    const song = this.song;
    // recordings end on their own through the source's onended
    if (!ctx || !song || !this.playing) return;

    const now = ctx.currentTime;
    const horizon = now + 0.55;

    while (this.noteCursor < song.notes.length) {
      const n = song.notes[this.noteCursor]!;
      const when = this.startedAt + n.t;
      if (when > horizon) break;
      this.noteCursor++;
      this.sing(n, Math.max(when, now + 0.005));
    }

    while (this.duffCursor < song.duff.length) {
      const d = song.duff[this.duffCursor]!;
      const when = this.startedAt + d.t;
      if (when > horizon) break;
      this.duffCursor++;
      if (this.duffOn) this.hit(d, Math.max(when, now + 0.005));
    }

    if (this.getTime() >= song.duration - 0.03) {
      this.songTime = song.duration;
      this.playing = false;
      this.stopScheduler();
      this.killVoices(0.18);
      this.handlers.onStateChange?.(false);
      this.handlers.onEnded?.();
    }
  }

  private killVoices(fade: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.active.forEach(({ src, stopAt }) => {
      try {
        src.stop(Math.min(stopAt, now + fade + 0.02));
      } catch {
        /* already stopped */
      }
    });
    this.active.clear();
    if (this.mix) {
      // fresh bus chain so a hard stop cannot leave a fading tail on the next play
      const old = this.mix;
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.linearRampToValueAtTime(0.0001, now + fade);
      window.setTimeout(() => {
        try {
          old.disconnect();
        } catch {
          /* noop */
        }
      }, (fade + 0.1) * 1000);
      this.buildBuses();
      if (this.duffBus) this.duffBus.gain.value = this.duffOn ? 0.5 : 0;
    }
  }

  /* --------------------------------------------------------------- voices */

  private track(src: AudioScheduledSourceNode, stopAt: number) {
    const entry: Tracked = { src, stopAt };
    this.active.add(entry);
    src.onended = () => {
      this.active.delete(entry);
      try {
        src.disconnect();
      } catch {
        /* noop */
      }
    };
  }

  private sing(n: NoteEvent, when: number) {
    const ctx = this.ctx;
    const buses = this.buses;
    if (!ctx || !buses) return;

    const dur = Math.max(0.09, n.dur);
    const release = n.role === "hum" ? 0.5 : clamp(dur * 0.4, 0.07, 0.3);
    const jitter = 1 + (rngFrom(`${n.t}|${n.freq}`)() - 0.5) * 0.0016;
    const freq = n.freq * jitter;
    const f = FORMANTS[n.vowel] ?? FORMANTS.a;

    const env = ctx.createGain();
    env.gain.value = 0.0001;

    const sum = ctx.createGain();
    sum.gain.value = 1;

    // three formant resonators in parallel
    for (let i = 0; i < 3; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f.f[i]! * (n.role === "hum" ? 0.8 : 1);
      bp.Q.value = f.q[i]!;
      const g = ctx.createGain();
      g.gain.value = f.g[i]! * (i === 0 ? 1 : 0.9);
      bp.connect(g);
      g.connect(sum);

      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.detune.value = i === 0 ? -6 : i === 1 ? 5 : 11;
      osc.frequency.setValueAtTime(freq, when);
      if (n.from && n.from > 0 && Math.abs(n.from / freq - 1) < 0.4) {
        osc.frequency.setValueAtTime(n.from, when);
        osc.frequency.exponentialRampToValueAtTime(freq, when + Math.min(0.1, dur * 0.3));
      }
      const oscGain = ctx.createGain();
      oscGain.gain.value = 0.5 / (i + 1.4);
      osc.connect(oscGain);
      oscGain.connect(bp);

      // delayed vibrato
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.1 + (i * 0.17);
      const vibDepth = ctx.createGain();
      vibDepth.gain.setValueAtTime(0.0001, when);
      vibDepth.gain.linearRampToValueAtTime(
        n.role === "hum" ? 0.6 : freq * (n.role === "lead" ? 0.0075 : 0.005),
        when + 0.34,
      );
      vib.connect(vibDepth);
      vibDepth.connect(osc.frequency);

      const stopAt = when + dur + release + 0.12;
      osc.start(when);
      osc.stop(stopAt);
      vib.start(when);
      vib.stop(stopAt);
      this.track(osc, stopAt);
      this.track(vib, stopAt);
    }

    // tame the top and the bottom
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = n.role === "hum" ? 1400 : 4300;
    lp.Q.value = 0.4;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = n.role === "hum" ? 60 : 95;

    sum.connect(lp);
    lp.connect(hp);
    hp.connect(env);

    let tail: AudioNode = env;
    if (n.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = n.pan;
      env.connect(p);
      tail = p;
    }
    tail.connect(buses[n.role]);

    const peak = clamp(n.gain, 0, 1) * (n.role === "lead" ? 0.5 : 0.34);
    const attack = n.role === "hum" ? 0.4 : n.role === "harm" ? 0.14 : 0.055;
    const a = Math.min(attack, dur * 0.5);
    const decayEnd = when + a + 0.07;
    const sustain = Math.max(decayEnd, when + dur);
    const floor = Math.max(0.0002, peak * 0.84);
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(peak, when + a);
    env.gain.exponentialRampToValueAtTime(floor, decayEnd);
    env.gain.setValueAtTime(floor, sustain);
    env.gain.exponentialRampToValueAtTime(0.0001, sustain + release);
  }

  private hit(d: DuffEvent, when: number) {
    const ctx = this.ctx;
    const bus = this.duffBus;
    if (!ctx || !bus || !this.noise) return;

    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.connect(bus);
    const gainPeak = clamp(d.gain, 0, 1) * (d.kind === "dum" ? 0.85 : 0.5);

    if (d.kind === "dum") {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(148, when);
      osc.frequency.exponentialRampToValueAtTime(58, when + 0.16);
      const body = ctx.createGain();
      body.gain.value = 0.9;
      osc.connect(body);
      body.connect(g);
      const stopAt = when + 0.45;
      osc.start(when);
      osc.stop(stopAt);
      this.track(osc, stopAt);

      const skin = ctx.createBufferSource();
      skin.buffer = this.noise;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 320;
      const sg = ctx.createGain();
      sg.gain.value = 0.35;
      skin.connect(lp);
      lp.connect(sg);
      sg.connect(g);
      skin.start(when);
      skin.stop(when + 0.2);
      this.track(skin, when + 0.22);

      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(gainPeak, when + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.34);
    } else {
      const skin = ctx.createBufferSource();
      skin.buffer = this.noise;
      skin.playbackRate.value = 1.4;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2100;
      bp.Q.value = 1.1;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 900;
      skin.connect(bp);
      bp.connect(hp);
      hp.connect(g);
      skin.start(when);
      skin.stop(when + 0.12);
      this.track(skin, when + 0.14);

      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(gainPeak, when + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
    }
  }
}

/* ------------------------------------------------------------------ utils */

function firstIndexAt<T extends { t: number }>(events: T[], time: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.t < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = white * 0.7 + last * 3;
  }
  return buf;
}

function createImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  const rng = rngFrom(`ir-${seconds}-${decay}`);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      const pre = i < rate * 0.01 ? i / (rate * 0.01) : 1;
      data[i] = (rng() * 2 - 1) * env * pre;
    }
    for (let k = 0; k < 14; k++) {
      const idx = Math.floor((0.007 + k * 0.014 + rng() * 0.007) * rate);
      if (idx < len) data[idx] += (rng() * 2 - 1) * (1 - k / 14) * 0.65;
    }
  }
  return buf;
}

export const engine = new NasheedEngine();
