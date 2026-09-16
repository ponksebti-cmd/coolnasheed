/**
 * Which book the app is bound in.
 *
 * The theme is the one setting that belongs to the machine rather than to the account:
 * a phone read in daylight and a laptop at night are not the same room. So the choice is
 * kept on the device, and `index.html` reads it before React exists — that is what makes
 * the first paint the right colour instead of a flash of the other one.
 *
 * The server still stores it (`user_prefs.theme`) so an account carries its own taste,
 * but it is only consulted on a device that has never made the choice. The house default
 * is the light book.
 */

export type Theme = "night" | "dawn";

export const DEFAULT_THEME: Theme = "dawn";

const KEY = "coolnasheed.theme";

/** The theme this device last showed, or null if it has never chosen. */
export function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "night" || value === "dawn" ? value : null;
  } catch {
    /* private mode, blocked storage: the caller falls back to the default */
    return null;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* the app still switches; it just cannot remember it before the next paint */
  }
}

/** The theme the currently signed-in account asked for, if it ever said so. */
export function accountTheme(stored: unknown): Theme | null {
  return stored === "night" || stored === "dawn" ? stored : null;
}

/**
 * Which theme to show: what this device chose, else what the account saved, else the
 * house default.
 */
export function resolveTheme(deviceChoice: Theme | null, saved: unknown): Theme {
  return deviceChoice ?? accountTheme(saved) ?? DEFAULT_THEME;
}
