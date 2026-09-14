import { create } from "zustand";

/** What the listener was trying to do when we asked them to sign in. */
export type AuthIntent = { label: string; run?: () => void };

type UiState = {
  nurOpen: boolean;
  commandOpen: boolean;
  shortcutsOpen: boolean;
  mobileNavOpen: boolean;
  authOpen: boolean;
  authMode: "signin" | "signup";
  authIntent: AuthIntent | null;
  setNur: (v: boolean) => void;
  toggleNur: () => void;
  setCommand: (v: boolean) => void;
  setShortcuts: (v: boolean) => void;
  setMobileNav: (v: boolean) => void;
  setAuth: (open: boolean, mode?: "signin" | "signup") => void;
  /** Ask for an account, remembering what they wanted to do so we can finish it. */
  requestAuth: (intent: AuthIntent, mode?: "signin" | "signup") => void;
};

export const useUi = create<UiState>((set, get) => ({
  nurOpen: false,
  commandOpen: false,
  shortcutsOpen: false,
  mobileNavOpen: false,
  authOpen: false,
  authMode: "signin",
  authIntent: null,
  setNur: (v) => set({ nurOpen: v }),
  toggleNur: () => set({ nurOpen: !get().nurOpen }),
  setCommand: (v) => set({ commandOpen: v }),
  setShortcuts: (v) => set({ shortcutsOpen: v }),
  setMobileNav: (v) => set({ mobileNavOpen: v }),
  setAuth: (open, mode) =>
    set(open ? { authOpen: true, authMode: mode ?? get().authMode } : { authOpen: false, authIntent: null }),
  requestAuth: (intent, mode) => set({ authOpen: true, authMode: mode ?? "signin", authIntent: intent }),
}));
