/**
 * Accounts, on Supabase.
 *
 * Credentials are Supabase Auth's business: this file never sees a password hash, and
 * never stores one. What it keeps is a mirror of the signed-in profile plus its
 * counters, refreshed on boot, on sign-in, and whenever the auth state changes in
 * another tab.
 *
 * Two things follow from having a real backend, and both are improvements on a
 * device-only library:
 *   • your loves, notes and sets are yours on every device, not this browser's
 *   • the database can count what happens — plays, notes, publishes — which is what
 *     makes the charts and the staff dashboard real rather than decorative
 *
 * Signing up makes a row in `profiles` through a database trigger, so there is no
 * "create the profile" step to forget and no window where an account exists without
 * one. The first account on a fresh project is made staff, which is how you get into
 * the moderation queue without touching the SQL editor.
 *
 * With no project configured the app still runs: the catalogue stays empty, and
 * every account-gated action explains that it needs Supabase. Listening offline beats
 * a blank page.
 */

import { create } from "zustand";
import { api, errorMessage } from "../lib/api";
import { ApiError, AuthError, DemoModeError } from "../lib/errors";
import { hasSupabase, maybeSb } from "../lib/supabase";
import type { ListenerStats, ProfileInput, User, UserRole } from "../../shared/types";

export type Account = {
  id: string;
  handle: string;
  name: string;
  bio: string;
  city: string;
  /** seed for the generated avatar pattern */
  seed: string;
  createdAt: number;
  email: string | null;
  role: UserRole;
};

export type AccountPatch = Partial<Pick<Account, "name" | "bio" | "city" | "seed">> & {
  nameAr?: string;
  tagline?: string;
  handle?: string;
};

export type SessionField = "name" | "handle" | "password" | "email" | "identity" | "city" | "form";

export type SessionResult =
  | { ok: true; account: Account; /** sign-up succeeded but the email still needs confirming */ pending?: boolean }
  | { ok: false; field: SessionField; msg: string; /** an informative pause rather than a failure */ pending?: boolean };

const HANDLE_RE = /^[a-z0-9._]{3,20}$/;

/** handles the catalogue already uses, so nobody impersonates a reciter or a seeded listener */
const RESERVED = new Set([
  "coolnasheed", "nur", "admin", "root", "staff", "system",
  "umm_sumayya", "fajr_walker", "ibn_al_bahr", "quiet_minaret", "sabr_and_coffee", "muhajir_1998",
  "layla.k", "abu_yusuf", "zaytuna_22", "night_of_qadr", "halabi_in_exile", "dust_and_light",
  "rawda_listener", "third_of_the_night", "sokoto_sings", "madrassa_dad",
  "yusuf", "rawda", "hanan", "muadh", "ibrahim", "halabi", "sami", "zayd",
]);

/* --------------------------------------------------------------- validation */

/**
 * Cheap checks before a round trip. The database repeats all of them — a check
 * constraint on the shape, a unique index on the handle, a `reserved_handles` table
 * for the catalogue's own names — and it is the only one that knows whether a handle
 * has been taken in the last second.
 */
export function validateHandle(raw: string): string | null {
  const handle = raw.trim().toLowerCase().replace(/^@/, "");
  if (!handle) return "Pick a handle.";
  if (!HANDLE_RE.test(handle)) return "3–20 characters: letters, numbers, dot, underscore.";
  if (RESERVED.has(handle)) return "That handle belongs to the catalogue itself.";
  return null;
}

export function validateName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 2) return "At least two characters.";
  if (name.length > 48) return "That is a biography, not a name.";
  return null;
}

export function validatePassword(raw: string): string | null {
  if (raw.length < 8) return "Eight characters minimum.";
  if (raw.length > 200) return "That is too long.";
  return null;
}

/** Required when Supabase is the backend: the email is what you sign in with. */
export function validateEmail(raw: string, required = hasSupabase): string | null {
  const email = raw.trim();
  if (!email) return required ? "An email address is required." : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "That is not an email address.";
  return null;
}

export function toAccount(user: User): Account {
  return {
    id: user.id,
    handle: user.handle,
    name: user.name,
    bio: user.bio,
    city: user.city,
    seed: user.seed,
    createdAt: user.createdAt,
    email: user.email ?? null,
    role: user.role,
  };
}

/** Which field a server error should be shown against. */
function fieldOf(err: unknown): SessionField {
  const field = err instanceof ApiError ? err.field : undefined;
  if (
    field === "handle" ||
    field === "name" ||
    field === "password" ||
    field === "email" ||
    field === "identity" ||
    field === "city"
  ) {
    return field;
  }
  return "form";
}

/* ------------------------------------------------------------------- store */

type SessionState = {
  user: User | null;
  stats: ListenerStats | null;
  /** the boot request has answered, successfully or not */
  ready: boolean;
  /** a project is configured and answered — false means an empty catalogue */
  online: boolean;
  /** a project is configured at all */
  configured: boolean;
  busy: boolean;
  /** kept for the selectors that predate the backend: [] or [the signed-in account] */
  accounts: Account[];
  currentId: string | null;

  load: () => Promise<void>;
  setSession: (user: User | null, stats?: ListenerStats | null) => void;
  setStats: (stats: ListenerStats) => void;
  setOnline: (online: boolean) => void;

  signUp: (input: { name: string; handle: string; password: string; email?: string; city?: string }) => Promise<SessionResult>;
  signIn: (identity: string, password: string) => Promise<SessionResult>;
  signOut: () => Promise<void>;
  update: (patch: AccountPatch) => Promise<SessionResult>;
  changePassword: (current: string, next: string) => Promise<SessionResult>;
  deleteAccount: (password?: string) => Promise<boolean>;
};

export const useSession = create<SessionState>()((set, get) => ({
  user: null,
  stats: null,
  ready: false,
  online: hasSupabase,
  configured: hasSupabase,
  busy: false,
  accounts: [],
  currentId: null,

  async load() {
    if (!hasSupabase) {
      get().setSession(null, null);
      set({ online: false, ready: true });
      return;
    }

    set({ busy: true });
    try {
      const session = await api.me();
      get().setSession(session?.user ?? null, session?.stats ?? null);
      set({ online: true, ready: true, busy: false });
    } catch (err) {
      get().setSession(null, null);
      set({ online: !(err instanceof ApiError && err.status === 0), ready: true, busy: false });
    }
  },

  setSession(user, stats) {
    set({
      user,
      stats: stats ?? null,
      accounts: user ? [toAccount(user)] : [],
      currentId: user?.id ?? null,
    });
  },

  setStats(stats) {
    set({ stats });
  },

  setOnline(online) {
    set({ online });
  },

  async signUp({ name, handle, password, email, city }) {
    const nameErr = validateName(name);
    if (nameErr) return { ok: false, field: "name", msg: nameErr };
    const handleErr = validateHandle(handle);
    if (handleErr) return { ok: false, field: "handle", msg: handleErr };
    const emailErr = validateEmail(email ?? "");
    if (emailErr) return { ok: false, field: "email", msg: emailErr };
    const passErr = validatePassword(password);
    if (passErr) return { ok: false, field: "password", msg: passErr };

    set({ busy: true });
    try {
      const result = await api.signup({
        name: name.trim(),
        handle: handle.trim().toLowerCase().replace(/^@/, ""),
        password,
        email: email?.trim(),
        city: city?.trim() || undefined,
      });

      // confirmations are on for this project: the account exists, the session does not
      if (result.pending) {
        set({ busy: false, online: true });
        return { ok: false, pending: true, field: "email", msg: result.message };
      }

      get().setSession(result.user, result.stats);
      set({ busy: false, online: true });
      return { ok: true, account: toAccount(result.user) };
    } catch (err) {
      set({ busy: false, online: !(err instanceof DemoModeError) && !(err instanceof ApiError && err.status === 0) });
      return { ok: false, field: fieldOf(err), msg: errorMessage(err, "Could not create the account.") };
    }
  },

  async signIn(identity, password) {
    const clean = identity.trim();
    if (!clean) return { ok: false, field: "identity", msg: "Enter your email address." };
    if (!password) return { ok: false, field: "password", msg: "Enter your password." };

    set({ busy: true });
    try {
      const session = await api.signin(clean, password);
      get().setSession(session.user, session.stats);
      set({ busy: false, online: true });
      return { ok: true, account: toAccount(session.user) };
    } catch (err) {
      set({ busy: false, online: !(err instanceof DemoModeError) && !(err instanceof ApiError && err.status === 0) });
      const field = fieldOf(err);
      return { ok: false, field: field === "form" ? "identity" : field, msg: errorMessage(err, "Could not sign you in.") };
    }
  },

  async signOut() {
    try {
      await api.signout();
    } catch {
      // the session is gone as far as this tab is concerned either way
    }
    get().setSession(null, null);
  },

  async update(patch) {
    const user = get().user;
    if (!user) return { ok: false, field: "form", msg: "You are not signed in." };
    if (patch.name !== undefined) {
      const nameErr = validateName(patch.name);
      if (nameErr) return { ok: false, field: "name", msg: nameErr };
    }
    if (patch.handle !== undefined) {
      const handleErr = validateHandle(patch.handle);
      if (handleErr) return { ok: false, field: "handle", msg: handleErr };
    }

    set({ busy: true });
    try {
      const body: ProfileInput = {};
      if (patch.name !== undefined) body.name = patch.name.trim();
      if (patch.nameAr !== undefined) body.nameAr = patch.nameAr.trim();
      if (patch.bio !== undefined) body.bio = patch.bio.trim();
      if (patch.city !== undefined) body.city = patch.city.trim();
      if (patch.handle !== undefined) body.handle = patch.handle.trim().toLowerCase().replace(/^@/, "");

      const session = await api.updateProfile(body);
      get().setSession(session.user, session.stats);
      set({ busy: false });
      return { ok: true, account: toAccount(session.user) };
    } catch (err) {
      set({ busy: false });
      return { ok: false, field: fieldOf(err), msg: errorMessage(err, "Could not save that.") };
    }
  },

  async changePassword(current, next) {
    const user = get().user;
    if (!user) return { ok: false, field: "form", msg: "You are not signed in." };
    const passErr = validatePassword(next);
    if (passErr) return { ok: false, field: "password", msg: passErr };

    set({ busy: true });
    try {
      await api.changePassword(current, next);
      set({ busy: false });
      return { ok: true, account: toAccount(user) };
    } catch (err) {
      set({ busy: false });
      return { ok: false, field: fieldOf(err), msg: errorMessage(err, "Could not change the password.") };
    }
  },

  async deleteAccount(password) {
    const user = get().user;
    if (!user) return false;
    set({ busy: true });
    try {
      await api.deleteAccount(password);
      get().setSession(null, null);
      set({ busy: false });
      return true;
    } catch {
      set({ busy: false });
      return false;
    }
  },
}));

/* ------------------------------------------------------------- auth events */

let bound = false;

/**
 * Follow Supabase's auth state: a sign-in in another tab, a refresh token that
 * expired, a confirmation link that just landed. `onChanged` is what the boot code
 * uses to reload the library when the account changes.
 */
export function bindAuthListener(onChanged?: (signedIn: boolean) => void): () => void {
  const client = maybeSb();
  if (!client || bound) return () => {};
  bound = true;

  const { data } = client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      useSession.getState().setSession(null, null);
      onChanged?.(false);
      return;
    }
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
      void useSession.getState().load().then(() => onChanged?.(true));
    }
  });

  return () => {
    bound = false;
    data.subscription.unsubscribe();
  };
}

/* --------------------------------------------------------------- selectors */

export function currentUser(): User | null {
  return useSession.getState().user;
}

export function currentUid(): string | null {
  return useSession.getState().user?.profileId ?? null;
}

export function currentAccount(): Account | null {
  const user = useSession.getState().user;
  return user ? toAccount(user) : null;
}

export function accountById(id: string | null | undefined): Account | null {
  if (!id) return null;
  const user = useSession.getState().user;
  return user && (user.id === id || user.profileId === id) ? toAccount(user) : null;
}

export function isSignedIn(): boolean {
  return useSession.getState().user !== null;
}

export function isStaff(): boolean {
  return useSession.getState().user?.role === "staff";
}

export { AuthError };
