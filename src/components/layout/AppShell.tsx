import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { clsx } from "clsx";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { PlayerBar } from "../player/PlayerBar";
import { ImmersivePlayer } from "../player/ImmersivePlayer";
import { NurPanel } from "../nur/NurPanel";
import { CommandPalette } from "../CommandPalette";
import { ShortcutsSheet } from "../ShortcutsSheet";
import { Icon } from "../ui/Icons";
import { engine } from "../../lib/audio/engine";
import { useLibrary } from "../../store/library";
import { usePlayer } from "../../store/player";
import { useUi } from "../../store/ui";
import { useKeyboard } from "../../lib/hooks";
import { getTrack } from "../../data/catalog";

export function AppShell() {
  const settings = useLibrary((s) => s.settings);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const player = usePlayer();
  const mobileNavOpen = useUi((s) => s.mobileNavOpen);
  const setMobileNav = useUi((s) => s.setMobileNav);
  const setShortcuts = useUi((s) => s.setShortcuts);
  const setNur = useUi((s) => s.setNur);
  const location = useLocation();
  const scroller = useRef<HTMLDivElement>(null);

  /* theme */
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", settings.theme === "night" ? "#07100D" : "#F4EFE3");
  }, [settings.theme]);

  /* push persisted audio settings into the engine once */
  useEffect(() => {
    engine.setVolume(settings.volume);
    engine.setDuff(settings.duff);
    engine.setSpace(settings.space);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* keep the engine in step with later setting changes made elsewhere */
  useEffect(() => {
    engine.setVolume(settings.volume);
  }, [settings.volume]);
  useEffect(() => {
    engine.setDuff(settings.duff);
  }, [settings.duff]);
  useEffect(() => {
    engine.setSpace(settings.space);
  }, [settings.space]);

  /* scroll to top on navigation */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: 0, behavior: "auto" });
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
    d: () => player.setDuff(!settings.duff),
    m: () => player.setVolume(settings.volume > 0 ? 0 : 0.85),
    l: () => {
      const id = player.trackId;
      if (id) toggleLike(id);
    },
    "/": (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("coolnasheed:focus-search"));
    },
    "?": () => setShortcuts(true),
    g: () => setNur(true),
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
          <div className="absolute inset-0 bg-[rgba(3,9,7,0.7)] backdrop-blur-sm" onClick={() => setMobileNav(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-[86vw] max-w-[320px] bg-bg2 shadow-[30px_0_90px_-30px_rgba(0,0,0,1)] toast-enter">
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
        <div ref={scroller} className="scroll-slim relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <TopBar onMenu={() => setMobileNav(true)} />
          <main key={location.pathname} className={clsx("page-enter mx-auto w-full max-w-[1400px] px-4 pb-10 pt-5 sm:px-6 lg:px-8")}>
            <Outlet />
          </main>
        </div>
        <PlayerBar />
      </div>

      <ImmersivePlayer />
      <NurPanel />
      <CommandPalette />
      <ShortcutsSheet />

      {/* tiny footer note, always available */}
      <div className="pointer-events-none fixed bottom-[92px] left-1/2 z-20 hidden -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-elev/85 px-3 py-1.5 text-[10.5px] text-muted backdrop-blur-md xl:flex">
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
