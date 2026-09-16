/**
 * Asking the database which version of the app it is.
 *
 * A project that has the *old* schema is the worst kind of broken: every symptom points
 * somewhere else. The composition columns are `NOT NULL` and the audio-only client does
 * not send them, so publishing fails with "null value in column maqam" — which a person
 * reads as "but I uploaded the file". `studio_drafts` does not exist yet, so the studio
 * silently saves nothing. This module is how the app stops guessing.
 *
 * `public.app_schema` holds one row and one string (migration 5 creates it). Reading it
 * over PostgREST costs one indexed row, needs no session, and answers three things at
 * once: is the schema there at all, is it the version this build expects, and if not,
 * exactly what to tell the person to do about it.
 */

import { maybeSb, hasSupabase } from "./supabase";

/** The version this build of the client writes against. Keep in step with the migration. */
export const EXPECTED_SCHEMA_VERSION = "profile-pictures-1";

export type SchemaState =
  /** no project configured: nothing to check, and the app says so elsewhere */
  | { state: "offline" }
  /** the project answered, and every table this build needs is there */
  | { state: "ok"; version: string }
  /** the project answered, but the schema is from an older build */
  | { state: "behind"; version: string | null; detail: string }
  /** the project answered, but there are no tables in it at all */
  | { state: "missing"; detail: string }
  /** the project could not be asked (network, key, cold start) */
  | { state: "unknown"; detail: string };

/** One sentence a person can act on, with the command that fixes it. */
export const FIX_LINE =
  "Run `npm run setup` — or open the SQL editor in Supabase and run `supabase/setup.sql` — then reload this page.";

export function isUsable(schema: SchemaState | null | undefined): boolean {
  return (
    !schema ||
    schema.state === "ok" ||
    schema.state === "offline" ||
    schema.state === "unknown"
  );
}

/** The sentence to show when the database is not what this build expects. */
export function schemaProblem(
  schema: SchemaState | null | undefined,
): string | null {
  if (!schema) return null;
  switch (schema.state) {
    case "missing":
      return `This Supabase project has no tables yet, so nothing can be saved or published. ${FIX_LINE}`;
    case "behind":
      return `This database is an older version of CoolNasheed's schema${
        schema.version
          ? ` (it reports “${schema.version}”, this build expects “${EXPECTED_SCHEMA_VERSION}”)`
          : ""
      }. Part of what this build writes has nowhere to go until it is updated. ${FIX_LINE}`;
    default:
      return null;
  }
}

/**
 * Ask once per page load, and remember the answer. A second call is free.
 *
 * The failure modes of a REST call are told apart by PostgREST's own codes: `PGRST205`
 * means the table is not in the schema cache (which is how "no such table" arrives),
 * `42501` means RLS refused, and anything else is treated as "could not ask" — the app
 * must not tell somebody their database is broken because their wifi dropped.
 */
let cached: Promise<SchemaState> | null = null;

/**
 * How long to wait before deciding the project is not answering.
 *
 * Longer than it looks like it needs to be, on purpose: supabase-js retries a 5xx
 * itself (four attempts with backoff, about seven seconds) and its final answer is
 * worth waiting for. This is the backstop for a request that never ends at all.
 */
const PROBE_TIMEOUT_MS = 15000;

export function checkSchema(force = false): Promise<SchemaState> {
  if (!force && cached) return cached;
  /* A request that never settles is a real failure mode (a captive portal, a host that
     accepts the connection and then says nothing). Promising a status that never arrives
     would leave the app unable to say anything at all, so the probe always answers. */
  cached = Promise.race([
    probe(),
    new Promise<SchemaState>((resolve) =>
      setTimeout(
        () =>
          resolve({
            state: "unknown",
            detail: "the project did not answer in time",
          }),
        PROBE_TIMEOUT_MS,
      ),
    ),
  ]);
  return cached;
}

export function schemaCheckedAt(): Promise<SchemaState> | null {
  return cached;
}

async function probe(): Promise<SchemaState> {
  if (!hasSupabase) return { state: "offline" };
  const client = maybeSb();
  if (!client) return { state: "offline" };

  try {
    const { data, error } = await client
      .from("app_schema")
      .select("version")
      .limit(1)
      .maybeSingle();

    if (error) {
      const code = (error as { code?: string }).code ?? "";
      const message = error.message ?? "";
      if (
        code === "PGRST205" ||
        code === "42P01" ||
        /could not find the table|does not exist/i.test(message)
      ) {
        /* No `app_schema`. Three possibilities, and they want three different sentences:
           the project is a build behind (it has the old tables), the project is empty, or
           it is half-built. `songs` exists in both shapes, so it is the honest test for
           "there is a database here"; `studio_drafts` arrived with this build. */
        const [songs, drafts] = await Promise.all([
          client.from("songs").select("id").limit(1),
          client.from("studio_drafts").select("profile_id").limit(1),
        ]);
        const gone = (result: {
          error: { code?: string; message?: string } | null;
        }) => {
          if (!result.error) return false;
          const err = result.error;
          return (
            err.code === "PGRST205" ||
            err.code === "42P01" ||
            /could not find the table|does not exist/i.test(err.message ?? "")
          );
        };
        if (!gone(songs)) {
          /* Tables, just not these: the older shape of the app. Saying "no tables yet"
             here would send somebody to set up a project that is already set up. */
          return {
            state: "behind",
            version: null,
            detail: drafts.error
              ? "the schema predates audio-only-1"
              : "studio_drafts exists without app_schema",
          };
        }
        if (!gone(drafts)) {
          return {
            state: "behind",
            version: null,
            detail: "studio_drafts exists without app_schema",
          };
        }
        return { state: "missing", detail: "no tables answered" };
      }
      if (code === "42501")
        return {
          state: "unknown",
          detail: "permission denied reading the schema version",
        };
      return {
        state: "unknown",
        detail: message || "the project did not answer",
      };
    }

    const version = typeof data?.version === "string" ? data.version : null;
    if (version === EXPECTED_SCHEMA_VERSION) return { state: "ok", version };
    return {
      state: "behind",
      version,
      detail: `reported ${version ?? "nothing"}`,
    };
  } catch (err) {
    return {
      state: "unknown",
      detail: err instanceof Error ? err.message : "the project did not answer",
    };
  }
}

/** Forget the cached answer — used after a write that could have changed it. */
export function invalidateSchema(): void {
  cached = null;
}
