/**
 * The publish contract, read from the Edge Function's side.
 *
 * `shared/fixtures/publish-cases.json` is the contract: a payload in, and either the
 * exact row that must come out or the exact refusal. It was recorded from this
 * validator and then read against the CHECK constraints on `public.songs` — and
 * `npm run sql:test` inserts every one of those rows into a real Postgres, so a row
 * in the fixture is a row the database accepts.
 *
 * What that makes this file is the regression half of a two-sided test. The other half
 * (`npm run contract:test`) holds `src/lib/wire.ts` — the browser's mirror of this
 * validator, which is what runs when the functions are not deployed — to the same
 * fixture. Two implementations, one contract, and neither can drift without the other
 * saying so.
 *
 *   deno test --allow-read supabase/functions/_shared/contract_test.ts
 */

import { songRowFrom } from "./validate.ts";
import { songFromRow, type SongDbRow } from "./songs.ts";
import { HttpError } from "./json.ts";

type Case = {
  name: string;
  input: Record<string, unknown>;
  row?: Record<string, unknown> | null;
  error?: { status: number; field?: string; says?: string };
};

type RowCase = {
  name: string;
  ownerHandle: string | null;
  row: Record<string, unknown>;
  song: Record<string, unknown> | null;
};

const fixture = JSON.parse(
  await Deno.readTextFile(new URL("../../../shared/fixtures/publish-cases.json", import.meta.url)),
) as { owner: string; cases: Case[]; songRows: RowCase[] };

/** The three placeholders the fixture uses instead of writing 41 lines and 600 characters out. */
function expand(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return input as never;
  const out = { ...(input as Record<string, unknown>) };
  if (out.lines === "FORTY_ONE") out.lines = Array.from({ length: 41 }, (_, i) => ({ tr: `yā rabbi ${i + 1}` }));
  if (out.note === "SIX_HUNDRED") out.note = "yā rabbi ".repeat(75);
  return out;
}

/** JSON with object keys in a fixed order, so key order is never mistaken for a difference. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Key-by-key comparison, because "they differ" is useless without saying where. */
function differences(expected: Record<string, unknown> | null | undefined, actual: Record<string, unknown>): string[] {
  const out: string[] = [];
  const keys = new Set([...Object.keys(expected ?? {}), ...Object.keys(actual)]);
  for (const key of [...keys].sort()) {
    const expectedValue = (expected ?? {})[key] ?? null;
    /* a row whose timestamp is unparseable falls back to "now", which the contract
       cannot write down — it asks for a number and that is all it can ask for */
    if (expectedValue === "NOW") {
      if (typeof actual[key] !== "number") out.push(`${key}: contract says a number, got ${stable(actual[key] ?? null)}`);
      continue;
    }
    const want = stable(expectedValue);
    const got = stable(actual[key] ?? null);
    if (want !== got) out.push(`${key}: contract ${want}, got ${got}`);
  }
  return out;
}

Deno.test("the publish validator answers the contract", () => {
  const problems: string[] = [];

  for (const c of fixture.cases) {
    try {
      const row = songRowFrom(expand(c.input) as never, fixture.owner) as unknown as Record<string, unknown>;
      if (c.error) {
        problems.push(`${c.name}: the contract says refuse (${c.error.field}, ${c.error.status}) but it produced a row`);
        continue;
      }
      for (const d of differences(c.row, row)) problems.push(`${c.name}: ${d}`);
    } catch (err) {
      if (!c.error) {
        problems.push(`${c.name}: the contract expects a row but it refused — ${(err as Error).message}`);
        continue;
      }
      if (!(err instanceof HttpError)) {
        problems.push(`${c.name}: refused with ${(err as Error).name}, not HttpError`);
        continue;
      }
      if (err.status !== c.error.status) problems.push(`${c.name}: status ${err.status}, contract says ${c.error.status}`);
      if (err.field !== c.error.field) problems.push(`${c.name}: field "${err.field}", contract says "${c.error.field}"`);
      if (c.error.says && !err.message.includes(c.error.says)) {
        problems.push(`${c.name}: "${err.message}" does not say "${c.error.says}"`);
      }
    }
  }

  if (problems.length) throw new Error(`\n  ${problems.join("\n  ")}`);
});

Deno.test("the row mapper answers the contract", () => {
  const problems: string[] = [];
  for (const c of fixture.songRows) {
    const song = songFromRow(c.row as unknown as SongDbRow, c.ownerHandle) as unknown as Record<string, unknown>;
    for (const d of differences(c.song, song)) problems.push(`${c.name}: ${d}`);
  }
  if (problems.length) throw new Error(`\n  ${problems.join("\n  ")}`);
});
