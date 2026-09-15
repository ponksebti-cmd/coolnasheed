/**
 * The player.
 *
 * A nasheed is a recording: one `<audio>` element, one source, and the browser
 * streams it from Supabase Storage. There is no synthesis here and no schedule to
 * keep — the element is the clock, `timeupdate` and `requestAnimationFrame` read it,
 * and everything else in the app (the seek bar, the lyric view, the visualizer, the
 * play beacon) is driven from that one number.
 *
 * The analyser is the only extra. It is wired up the first time something is played,
 * because an `AudioContext` may only be created after a user gesture, and it is
 * optional: in a test environment, or a browser that refuses, playback carries on
 * without it and the visualizer simply draws silence.
 */

export type PlayerHandlers = {
  onStateChange?: (playing: boolean) => void;
  onEnded?: () => void;
  onError?: () => void;
};

class NasheedPlayer {
  private el: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private spectrum = new Uint8Array(0);
  private detached = false;

  handlers: PlayerHandlers = {};

  /** The element, created once and reused for the life of the page. */
  private element(): HTMLAudioElement | null {
    if (typeof Audio === "undefined") return null;
    if (!this.el) {
      const el = new Audio();
      el.preload = "metadata";
      el.crossOrigin = "anonymous";
      el.addEventListener("ended", () => this.handlers.onEnded?.());
      el.addEventListener("play", () => this.handlers.onStateChange?.(true));
      el.addEventListener("pause", () => this.handlers.onStateChange?.(false));
      el.addEventListener("error", () => this.handlers.onError?.());
      this.el = el;
    }
    return this.el;
  }

  /**
   * Route playback through a Web Audio graph so the visualizer has something to
   * read. Safe to call more than once, and a no-op where Web Audio is missing.
   */
  private attachAnalyser(el: HTMLAudioElement): void {
    if (this.analyser || this.detached) return;
    const Ctor: typeof AudioContext | undefined =
      typeof window === "undefined"
        ? undefined
        : window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.detached = true;
      return;
    }
    try {
      const ctx = new Ctor();
      const source = ctx.createMediaElementSource(el);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      this.ctx = ctx;
      this.analyser = analyser;
      this.spectrum = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      // no Web Audio (or a cross-origin stream the graph refuses): play on without it
      this.detached = true;
    }
  }

  /** Point the element at a recording and start again from `startAt` seconds. */
  load(url: string, startAt = 0): void {
    const el = this.element();
    if (!el) return;
    if (el.src !== url) el.src = url;
    try {
      el.currentTime = Math.max(0, startAt);
    } catch {
      // the metadata has not arrived yet; the seek is harmless to skip
    }
  }

  async play(): Promise<void> {
    const el = this.element();
    if (!el) return;
    this.attachAnalyser(el);
    if (this.ctx?.state === "suspended") await this.ctx.resume().catch(() => undefined);
    try {
      await el.play();
    } catch {
      this.handlers.onError?.();
    }
  }

  pause(): void {
    this.el?.pause();
  }

  seek(seconds: number): void {
    const el = this.el;
    if (!el) return;
    const target = Math.max(0, seconds);
    try {
      el.currentTime = target;
    } catch {
      // seeking before the metadata lands throws; the next tick will do it
    }
  }

  setVolume(v: number): void {
    if (this.el) this.el.volume = Math.min(1, Math.max(0, v));
  }

  getVolume(): number {
    return this.el?.volume ?? 1;
  }

  getTime(): number {
    return this.el?.currentTime ?? 0;
  }

  /**
   * How long the recording is. Publishers store `durationMs` when they upload, so
   * that wins; the element's own metadata is the fallback while it loads.
   */
  getDuration(fallback = 0): number {
    const own = this.el?.duration;
    return Number.isFinite(own) && own ? (own as number) : fallback;
  }

  get playing(): boolean {
    return !!this.el && !this.el.paused && !this.el.ended;
  }

  /** Live frequency data for the visualizer; empty when there is no analyser. */
  readSpectrum(): Uint8Array {
    if (!this.analyser) return this.spectrum;
    this.analyser.getByteFrequencyData(this.spectrum);
    return this.spectrum;
  }
}

/** The one player every part of the app talks to. */
export const player = new NasheedPlayer();
