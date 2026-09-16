import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { clsx } from "clsx";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { PlayerBar } from "../player/PlayerBar";
import { MobileTabBar } from "./MobileTabBar";
import { ImmersivePlayer } from "../player/ImmersivePlayer";
import { CommandPalette } from "../CommandPalette";
import { ShortcutsSheet } from "../ShortcutsSheet";
import { AuthModal } from "../auth/AuthModal";
import { Icon } from "../ui/Icons";
import { useLibrary } from "../../store/library";
import { usePlayer } from "../../store/player";
import { useUi } from "../../store/ui";
import { useKeyboard } from "../../lib/hooks";
import { getTrack } from "../../data/catalog";
import { useBoot } from "../../lib/boot";
import { SetupSqlButton } from "../SetupSqlButton";
import { storeTheme } from "../../lib/theme";

export function AppShell() {
  const settings = useLibrary((s) => s.settings);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const player = usePlayer();
  const mobileNavOpen = useUi((s) => s.mobileNavOpen);
  const setMobileNav = useUi((s) => s.setMobileNav);
  const setShortcuts = useUi((s) => s.setShortcuts);
  const location = useLocation();
  const scroller = useRef<HTMLDivElement>(null);

  /* the catalogue, the session and the beacon, once, before anything else needs them */
  const boot = useBoot();
  const [noticeClosed, setNoticeClosed] = useState(false);

  /* The route veil is mounted for the length of its animation and then removed rather
     than parked at opacity 0. Leaving a full-area `backdrop-filter` element in the DOM
     is how a page stays frosted: browsers disagree about whether the element's own
     opacity hides a filter applied to what is behind it, and a layer nobody asked for
     is still a layer. Mounted, played, gone. */
  const [veilKey, setVeilKey] = useState<string | null>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setVeilKey(location.pathname);
    const timer = window.setTimeout(() => setVeilKey(null), 520);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);
  useEffect(() => {
    if (!boot) return;
    document.documentElement.dataset.backend = boot.source;
    // a new answer is a new notice, even if the last one was dismissed
    setNoticeClosed(false);
  }, [boot]);

  /* theme */
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    storeTheme(settings.theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta)
      meta.setAttribute(
        "content",
        settings.theme === "night" ? "#07100D" : "#F4EFE3",
      );
  }, [settings.theme]);

  /* the volume and mute in the settings row are the audio element's, always */
  useEffect(() => {
    usePlayer.getState().setVolume(settings.volume);
  }, [settings.volume]);

  useEffect(() => {
    usePlayer.getState().setMuted(settings.muted);
  }, [settings.muted]);

  /* scroll to top on navigation */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (typeof el.scrollTo === "function")
      el.scrollTo({ top: 0, behavior: "auto" });
    else el.scrollTop = 0;
  }, [location.pathname]);

  /* keyboard */
  useKeyboard({
    " ": (e) => {
      e.preventDefault();
      player.toggle();
    },
    arrowright: (e) => {
      if (e.shiftKey) {
        e.preventDefault();
        player.next();
      } else {
        e.preventDefault();
        player.nudge(5);
      }
    },
    arrowleft: (e) => {
      if (e.shiftKey) {
        e.preventDefault();
        player.prev();
      } else {
        e.preventDefault();
        player.nudge(-5);
      }
    },
    n: () => player.next(),
    b: () => player.prev(),
    i: () => player.setImmersive(!player.immersive),
    m: () => player.toggleMute(),
    l: () => {
      const id = player.trackId;
      if (id) toggleLike(id);
    },
    "/": (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("coolnasheed:focus-search"));
    },
    "?": () => setShortcuts(true),
  });

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-bg text-text">
      {/* desktop sidebar */}
      <div className="hidden w-[248px] shrink-0 lg:block xl:w-[268px]">
        <Sidebar />
      </div>

      {/* mobile drawer */}
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-[95] lg:hidden veil-enter">
          <div
            className="absolute inset-0 bg-[rgba(3,9,7,0.7)] backdrop-blur-sm"
            onClick={() => setMobileNav(false)}
            aria-hidden
          />
          <div className="materialize shadow-art absolute inset-y-0 left-0 w-[86vw] max-w-[320px] border-r border-line2 bg-bg2/98 backdrop-blur-xl">
            <button
              className="btn-icon absolute right-2 top-3 z-10 rounded-full p-2"
              onClick={() => setMobileNav(false)}
              aria-label="Close menu"
            >
              <Icon name="close" size={18} />
            </button>
            <Sidebar onNavigate={() => setMobileNav(false)} />
          </div>
        </div>
      ) : null}

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* the reading area, and the veil that covers exactly it */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scroller}
            className="scroll-slim relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          >
            <TopBar onMenu={() => setMobileNav(true)} />

            {/* The backend answering badly is worth one line on the page — the shell
              still renders, the catalogue is simply empty until it answers. */}
            {boot?.error && !noticeClosed ? (
              <div
                role="status"
                className="mx-4 mt-3 flex items-start gap-2.5 rounded-xl border border-line bg-surface2/60 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted sm:mx-6 lg:mx-8"
              >
                <Icon
                  name="server"
                  size={14}
                  className="mt-0.5 shrink-0 text-gold"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-text/90">{boot.error}</p>
                  {boot.needsSetup ? (
                    <p className="mt-1">
                      {/* The sentence above already explains which state the database is
                          in and what to run; this is the part that says how, right here,
                          without a terminal. */}
                      Copy the SQL below, paste it into Supabase&apos;s SQL
                      editor and press Run, then reload this page. It is safe to
                      run more than once: it only adds what is missing. (On your
                      own machine,{" "}
                      <code className="rounded bg-bg/70 px-1.5 py-0.5 font-mono text-[11.5px] text-goldsoft">
                        npm run setup
                      </code>{" "}
                      does the same thing from the terminal.)
                    </p>
                  ) : null}
                  {boot.needsSetup ? <SetupSqlButton /> : null}
                </div>
                <button
                  type="button"
                  onClick={() => setNoticeClosed(true)}
                  className="btn-icon -mr-1 -mt-1 shrink-0 rounded-full p-1.5"
                  aria-label="Dismiss"
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            ) : null}
            <main
              key={location.pathname}
              className={clsx(
                "route-in mx-auto w-full max-w-[1400px] px-4 pb-10 pt-5 sm:px-6 lg:px-8",
              )}
            >
              <Outlet />
            </main>
          </div>

          {/* Frosts over and clears while the new page settles in. A sibling of the
              scroller, not a child, so it stays out of the scroll coordinate space: it
              always covers the reading area and leaves the transport below untouched. */}
          {veilKey ? (
            <div key={`veil:${veilKey}`} className="route-veil" aria-hidden />
          ) : null}
        </div>
        <PlayerBar />
        <MobileTabBar />
      </div>

      <ImmersivePlayer />
      <CommandPalette />
      <ShortcutsSheet />
      <AuthModal />

      {/* tiny footer note, always available */}
      <div className="glass pointer-events-none fixed bottom-[92px] left-1/2 z-20 hidden -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 text-[10.5px] text-muted xl:flex">
        <Icon name="command" size={11} />
        <span>+ K for commands · ? for shortcuts</span>
        {player.trackId ? (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">{getTrack(player.trackId)?.title}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
