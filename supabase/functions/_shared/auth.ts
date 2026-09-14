/**
 * Who is calling.
 *
 * `verify_jwt = true` in supabase/config.toml already rejects a missing or forged
 * token for the functions that require an account. What is left to do here is
 * answer three questions the database cannot answer from a bare JWT:
 *
 *   1. which profile does this uid belong to (and does it exist at all)?
 *   2. is that profile staff?
 *   3. which client should the handler write with?
 *
 * The client handed back always carries the caller's own Authorization header, so
 * every write the handler makes is still subject to Row Level Security.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { anonClient } from "./db.ts";
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

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  return header && header.toLowerCase().startsWith("bearer ") ? header : null;
}

/**
 * Resolve the caller without requiring one. Returns `null` for an anonymous request,
 * and throws only when a token is present but does not check out.
 */
export async function maybeCaller(req: Request): Promise<Caller | null> {
  const authorization = bearer(req);
  const client = anonClient(authorization);
  if (!authorization) return null;

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new HttpError("That session is no longer valid.", 401);
  }

  const { data: profile } = await client
    .from("profiles")
    .select("id, handle, name, role, kind, verified")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    client,
    profile: (profile as CallerProfile | null) ?? null,
  };
}

/** Require an account. Throws 401 otherwise. */
export async function requireCaller(req: Request): Promise<Caller> {
  const caller = await maybeCaller(req);
  if (!caller) {
    throw new HttpError("You need an account for that.", 401);
  }
  return caller;
}

/** Require staff. Throws 403 for a signed-in listener, 401 for nobody. */
export async function requireStaff(req: Request): Promise<Caller> {
  const caller = await requireCaller(req);
  if (!caller.profile || caller.profile.role !== "staff") {
    throw new HttpError("That is a staff-only action.", 403);
  }
  return caller;
}
