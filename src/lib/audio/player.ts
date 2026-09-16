/**
 * The player.
 *
 * One `<audio>` element, wrapped in the small amount of machinery a streaming app
 * actually needs:
 *
 *   · a single element, reused for every track, so a change of track does not leak
 *     decoders or race two streams against each other
 *   · `crossOrigin="anonymous"` and `preload="metadata"`, so the CDN serves it and a
 *     first play is not a 40 MB download
 *   · a bounded retry when the network drops mid-stream, and a real error when it
 *     does not come back
 *   · the Media Session API, so the lock screen and the keyboard media keys work
 *   · `currentTime` read from the element, never from a timer, so the progress bar
 *     cannot drift
 *
 * Nothing here generates audio. A nasheed is an mp3 on a CDN and this plays it.
 */

export type PlayerHandlers = {
  onTime?: (seconds: number) => void;
  onDuration?: (seconds: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onEnded?: () => void;
  onWaiting?: (waiting: boolean) => void;
  onError?: (message: string) => void;
};

export type LoadOptions = { startAt?: number; autoplay?: boolean };

/** How many times a stream may be re-established before we show the failure. */
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 800;

export class AudioPlayer {
  private element: HTMLAudioElement | null = null;
  private readonly listeners: Array<[string, EventListener]> = [];

  private url: string | null = null;
  private retries = 0;
  private wantPlaying = false;
  private volume = 0.85;
  private muted = false;
  private pendingSeek: number | null = null;
  private retryTimer: number | null = null;
  private metadata: { title: string; artist: string; artwork?: string | null } | null = null;

  handlers: PlayerHandlers = {};

  /* ------------------------------------------------------------ lifecycle */

  /**
   * The element, created on first use and never before: constructing an
   * `HTMLAudioElement` at import time would touch the network on a page that never
   * plays anything.
   */
  private el(): HTMLAudioElement | null {
    if (this.element) return this.element;
    if (typeof Audio === "undefined") return null;

    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "metadata";
    audio.volume = this.volume;
    this.element = audio;

    const bind = (event: string, handler: EventListener) => {
      audio.addEventListener(event, handler);
      this.listeners.push([event, handler]);
    };

    bind("timeupdate", () => this.handlers.onTime?.(this.getTime()));
    bind("durationchange", () => this.handlers.onDuration?.(this.getDuration()));
    bind("loadedmetadata", () => {
      this.retries = 0;
      this.handlers.onDuration?.(this.getDuration());
      if (this.pendingSeek !== null) {
        const target = this.pendingSeek;
        this.pendingSeek = null;
        this.seek(target);
      }
      if (this.wantPlaying) void this.play();
    });
    bind("play", () => this.handlers.onPlayingChange?.(true));
    bind("pause", () => this.handlers.onPlayingChange?.(false));
    bind("waiting", () => this.handlers.onWaiting?.(true));
    bind("playing", () => {
      this.retries = 0;
      this.handlers.onWaiting?.(false);
      this.handlers.onPlayingChange?.(true);
    });
    bind("canplay", () => this.handlers.onWaiting?.(false));
    bind("ended", () => {
      this.wantPlaying = false;
      this.handlers.onPlayingChange?.(false);
      this.handlers.onEnded?.();
    });
    bind("error", () => this.handleError());

    return audio;
  }

  /**
   * A dropped connection is retried from where it got to, because it is worth
   * retrying and the listener keeps their position. A file that is missing or
   * cannot be decoded is not: it will still be missing in two seconds, and making
   * someone wait through three back-offs to hear that is not patience, it is a
   * spinner lying about what is happening.
   */
  private handleError(): void {
    const audio = this.element;
    if (!audio || !this.url) return;

    const code = audio.error?.code;
    // A user pressing stop, or a source we replaced on purpose, is not an error.
    if (code === MediaError.MEDIA_ERR_ABORTED) return;

    const permanent =
      code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === MediaError.MEDIA_ERR_DECODE;

    if (!permanent && this.retries < MAX_RETRIES) {
      this.retries += 1;
      const resumeAt = audio.currentTime || this.pendingSeek || 0;
      this.pendingSeek = resumeAt;
      if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
      this.retryTimer = window.setTimeout(() => {
        if (!this.url) return;
        this.retryTimer = null;
        audio.src = this.url;
        audio.load();
      }, RETRY_DELAY_MS * this.retries);
      this.handlers.onWaiting?.(true);
      return;
    }

    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.wantPlaying = false;
    this.handlers.onWaiting?.(false);
    this.handlers.onError?.(
      permanent
        ? "That recording could not be played — the file may be missing or corrupted."
        : "The recording stopped and would not restart. Check your connection.",
    );
  }

  /* --------------------------------------------------------------- loading */

  /**
   * Point the player at a recording. Resolves once the element has loaded its
   * metadata (or immediately when there is nothing to load), so the caller can read
   * the real duration before deciding to play.
   */
  async load(url: string | null, options: LoadOptions = {}): Promise<void> {
    const audio = this.el();
    this.retries = 0;
    this.pendingSeek = options.startAt ?? null;
    this.handlers.onTime?.(options.startAt ?? 0);

    if (!audio) {
      // No audio element in this environment (a test harness, a browser without media).
      this.url = url;
      return;
    }

    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (this.url === url && url) {
      if (options.startAt !== undefined) this.seek(options.startAt);
      if (options.autoplay) await this.play();
      return;
    }

    this.url = url;
    this.wantPlaying = !!options.autoplay;

    if (!url) {
      audio.removeAttribute("src");
      audio.load();
      this.handlers.onDuration?.(0);
      return;
    }

    audio.src = url;
    audio.load();
    this.applyMediaSession();

    await new Promise<void>((resolve) => {
      if (audio.readyState >= 1) return resolve();
      const done = () => {
        audio.removeEventListener("loadedmetadata", done);
        audio.removeEventListener("error", done);
        resolve();
      };
      audio.addEventListener("loadedmetadata", done);
      audio.addEventListener("error", done);
      // never hold a caller hostage to a slow CDN
      window.setTimeout(done, 12_000);
    });

    if (options.autoplay) await this.play();
  }

  async play(): Promise<void> {
    const audio = this.el();
    this.wantPlaying = true;
    if (!audio || !this.url) return;
    try {
      await audio.play();
      this.handlers.onPlayingChange?.(true);
    } catch (error) {
      // Autoplay policy: the browser wants a gesture. Not an error worth shouting about.
      const name = error instanceof Error ? error.name : "";
      if (name === "NotAllowedError") {
        this.wantPlaying = false;
        this.handlers.onPlayingChange?.(false);
        return;
      }
      this.handleError();
    }
  }

  pause(): void {
    this.wantPlaying = false;
    this.element?.pause();
    this.handlers.onPlayingChange?.(false);
  }

  stop(): void {
    const audio = this.element;
    this.wantPlaying = false;
    this.url = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    this.handlers.onPlayingChange?.(false);
    this.handlers.onTime?.(0);
  }

  /** Seek, whether or not the metadata has arrived yet. */
  seek(seconds: number): void {
    const audio = this.el();
    const target = Math.max(0, seconds);
    if (!audio || audio.readyState === 0) {
      this.pendingSeek = target;
      this.handlers.onTime?.(target);
      return;
    }
    const limit = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.15) : target;
    audio.currentTime = Math.min(target, limit);
    this.handlers.onTime?.(audio.currentTime);
  }

  setVolume(volume: number): void {
    this.volume = Math.min(Math.max(volume, 0), 1);
    if (this.element) this.element.volume = this.muted ? 0 : this.volume;
    if (typeof navigator !== "undefined" && "volume" in navigator) {
      // no-op — kept for the type of navigator in some runtimes
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.element) this.element.volume = muted ? 0 : this.volume;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get volumeLevel(): number {
    return this.volume;
  }

  /* ----------------------------------------------------------------- reads */

  getTime(): number {
    return this.element?.currentTime ?? 0;
  }

  /** Real duration in seconds; 0 until metadata has arrived. */
  getDuration(): number {
    const duration = this.element?.duration;
    return Number.isFinite(duration) ? Math.max(0, duration ?? 0) : 0;
  }

  get isPlaying(): boolean {
    const audio = this.element;
    return !!audio && !audio.paused && !audio.ended && audio.readyState > 2;
  }

  get isWaiting(): boolean {
    return !!this.element && this.element.readyState < 3 && this.wantPlaying;
  }

  get currentUrl(): string | null {
    return this.url;
  }

  get shouldPlay(): boolean {
    return this.wantPlaying;
  }

  /* ------------------------------------------------------------ media keys */

  /**
   * Lock-screen and keyboard media keys. Best effort by design: a browser without the
   * API, or a user who has denied it, simply does not get the controls.
   */
  private applyMediaSession(): void {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const meta = this.metadata;
    try {
      session.metadata = meta
        ? new MediaMetadata({
            title: meta.title,
            artist: meta.artist,
            album: "CoolNasheed",
            artwork: meta.artwork ? [{ src: meta.artwork }] : [],
          })
        : null;
      session.setActionHandler("play", () => void this.play());
      session.setActionHandler("pause", () => this.pause());
      session.setActionHandler("seekbackward", () => this.seek(this.getTime() - 10));
      session.setActionHandler("seekforward", () => this.seek(this.getTime() + 10));
      session.setActionHandler("seekto", (details) => {
        if (typeof details.seekTime === "number") this.seek(details.seekTime);
      });
    } catch {
      // an unsupported action handler throws in some browsers; the rest still work
    }
  }

  setMetadata(meta: { title: string; artist: string; artwork?: string | null } | null): void {
    this.metadata = meta;
    this.applyMediaSession();
  }

  /** Drop every listener and release the element. */
  destroy(): void {
    this.pause();
    for (const [event, handler] of this.listeners) this.element?.removeEventListener(event, handler);
    this.listeners.length = 0;
    this.element = null;
    this.url = null;
  }
}

export const player = new AudioPlayer();
