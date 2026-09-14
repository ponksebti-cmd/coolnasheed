import { create } from "zustand";

type UiState = {
  nurOpen: boolean;
  commandOpen: boolean;
  shortcutsOpen: boolean;
  mobileNavOpen: boolean;
  setNur: (v: boolean) => void;
  toggleNur: () => void;
  setCommand: (v: boolean) => void;
  setShortcuts: (v: boolean) => void;
  setMobileNav: (v: boolean) => void;
};

export const useUi = create<UiState>((set, get) => ({
  nurOpen: false,
  commandOpen: false,
  shortcutsOpen: false,
  mobileNavOpen: false,
  setNur: (v) => set({ nurOpen: v }),
  toggleNur: () => set({ nurOpen: !get().nurOpen }),
  setCommand: (v) => set({ commandOpen: v }),
  setShortcuts: (v) => set({ shortcutsOpen: v }),
  setMobileNav: (v) => set({ mobileNavOpen: v }),
}));
