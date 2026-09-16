import { create } from "zustand";

/** What the listener was trying to do when we asked them to sign in. */
export type AuthIntent = { label: string; run?: () => void };

type UiState = {
  commandOpen: boolean;
  shortcutsOpen: boolean;
  mobileNavOpen: boolean;
  authOpen: boolean;
  authMode: "signin" | "signup";
  authIntent: AuthIntent | null;
  setCommand: (v: boolean) => void;
  setShortcuts: (v: boolean) => void;
  setMobileNav: (v: boolean) => void;
  setAuth: (open: boolean, mode?: "signin" | "signup") => void;
  /** Ask for an account, remembering what they wanted to do so we can finish it. */
  requestAuth: (intent: AuthIntent, mode?: "signin" | "signup") => void;
};

export const useUi = create<UiState>((set, get) => ({
  commandOpen: false,
  shortcutsOpen: false,
  mobileNavOpen: false,
  authOpen: false,
  authMode: "signin",
  authIntent: null,
  setCommand: (v) => set({ commandOpen: v }),
  setShortcuts: (v) => set({ shortcutsOpen: v }),
  setMobileNav: (v) => set({ mobileNavOpen: v }),
  setAuth: (open, mode) =>
    set(open ? { authOpen: true, authMode: mode ?? get().authMode } : { authOpen: false, authIntent: null }),
  requestAuth: (intent, mode) => set({ authOpen: true, authMode: mode ?? "signin", authIntent: intent }),
}));
