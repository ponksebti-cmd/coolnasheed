/**
 * Who is calling.
 *
 * `verify_jwt = true` in supabase/config.toml rejects a missing or forged token before
 * the handler runs. What is left is the question the database cannot answer from a bare
 * JWT: which profile does this uid belong to, and is that profile staff?
 *
 * The answer is memoised per request, so a handler that checks the caller twice pays
 * for it once. Every lookup carries a deadline, and the client handed back always
 * carries the caller's own Authorization header — so a write made by a handler is
 * still subject to Row Level Security.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { anonClient, withTimeout } from "./db.ts";
import { HttpError } from "./json.ts";

export type CallerProfile = {
  id: string;
  handle: string;
  name: string;
  role: "listener" | "staff";
  kind: "listener" | "artist";
  verified: boolean;
};

export type Caller = {
  id: string;
  email: string | null;
  /** a client that acts as this caller, RLS and all */
  client: SupabaseClient;
  profile: CallerProfile | null;
};

const CACHE = new WeakMap<Request, Promise<Caller | null>>();

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  return header && header.toLowerCase().startsWith("bearer ") ? header : null;
}

async function resolve(req: Request): Promise<Caller | null> {
  const authorization = bearer(req);
  const client = anonClient(authorization);
  if (!authorization) return null;

  const { data, error } = await withTimeout(client.auth.getUser(), 6000, "auth.getUser");
  if (error || !data?.user) {
    throw new HttpError("That session is no longer valid. Sign in again.", 401);
  }

  const { data: profile, error: profileError } = await withTimeout(
    client
      .from("profiles")
      .select("id, handle, name, role, kind, verified")
      .eq("id", data.user.id)
      .maybeSingle(),
    5000,
    "profiles.select",
  );
  if (profileError) throw new HttpError("Your profile would not load.", 502);

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    client,
    profile: (profile as CallerProfile | null) ?? null,
  };
}

/**
 * The caller, or null for an anonymous request. Throws only when a token is present
 * and does not check out, which is the one case worth telling somebody about.
 */
export function maybeCaller(req: Request): Promise<Caller | null> {
  const existing = CACHE.get(req);
  if (existing) return existing;
  const pending = resolve(req).catch((error) => {
    CACHE.delete(req);
    throw error;
  });
  CACHE.set(req, pending);
  return pending;
}

export async function requireCaller(req: Request): Promise<Caller> {
  const caller = await maybeCaller(req);
  if (!caller) throw new HttpError("You need an account for that.", 401);
  if (!caller.profile) {
    // A token without a profile row means the account was deleted mid-session.
    throw new HttpError("That account no longer exists.", 401);
  }
  return caller;
}

export async function requireStaff(req: Request): Promise<Caller> {
  const caller = await requireCaller(req);
  if (caller.profile!.role !== "staff") {
    throw new HttpError("That is a staff-only action.", 403);
  }
  return caller;
}
