/**
 * The publish contract, read from the browser's side.
 *
 * Publishing can take two roads: through the `publish` Edge Function, whose validator
 * is `supabase/functions/_shared/validate.ts`, or — when no functions are deployed —
 * straight from the browser to PostgREST, whose validator is `songRowFromInput()` in
 * `src/lib/wire.ts`. They are hand-written mirrors, and a mirror that drifts is worse
 * than no mirror: the same form would be accepted one day and refused the next,
 * depending on whether a function happened to be deployed.
 *
 * So both are held to `shared/fixtures/publish-cases.json`. The Deno half is
 * `supabase/functions/_shared/contract_test.ts`; this is the other half, and it is the
 * one on trial, because the fixture was recorded from the function and reviewed against
 * the CHECK constraints on `public.songs`.
 *
 *   npm run contract:test
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { songFromRow, songRowFromInput, type SongRow } from "../src/lib/wire";
/* The function side's mapper, bundled here too. It is a pure module — no Deno globals —
   so the same run can hold both row mappers to the fixture, which is the only way this
   one gets executed without a Deno toolchain. */
import { songFromRow as songFromRowInFunction } from "../supabase/functions/_shared/songs";
import { ApiError } from "../src/lib/errors";

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
  // process.cwd(), not import.meta.url: esbuild bundles this to CJS, where the URL is
  // a path that no longer points at the source tree
  readFileSync(join(process.cwd(), "shared/fixtures/publish-cases.json"), "utf8"),
) as { owner: string; cases: Case[]; songRows: RowCase[] };

/** The three placeholders the fixture uses instead of writing 41 lines and 600 characters out. */
function expand(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return input as never;
  const out = { ...(input as Record<string, unknown>) };
  if (out.lines === "FORTY_ONE") out.lines = Array.from({ length: 41 }, (_, i) => ({ tr: `yā rabbi ${i + 1}` }));
  if (out.note === "SIX_HUNDRED") out.note = "yā rabbi ".repeat(75);
  return out;
}

/* ------------------------------------------------------------------ reporting */

const colour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) => (colour ? `\x1b[${code}m${text}\x1b[0m` : text);
const green = paint("32");
const red = paint("31");
const dim = paint("2");

let checks = 0;
const failures: string[] = [];

function check(label: string, problems: string[]) {
  checks += 1;
  if (problems.length === 0) console.log(`  ${green("✓")} ${label}`);
  else {
    failures.push(...problems.map((p) => `${label}: ${p}`));
    console.log(`  ${red(`✗ ${label}`)}`);
    for (const problem of problems) console.log(`      ${dim(problem)}`);
  }
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
      if (typeof actual[key] !== "number") out.push(`${key}: contract says a number, mirror says ${JSON.stringify(actual[key] ?? null)}`);
      continue;
    }
    const want = stable(expectedValue);
    const got = stable(actual[key] ?? null);
    if (want !== got) out.push(`${key}: contract ${want}, mirror ${got}`);
  }
  return out;
}

/* ---------------------------------------------------------------- the contract */

console.log(`\n\x1b[1mCoolNasheed · the publish contract, browser side\x1b[0m ${dim(`(${fixture.cases.length} cases, ${fixture.songRows.length} row mappings)`)}`);

console.log("\n\x1b[1mWhat the mirror accepts, and what it produces\x1b[0m");
for (const c of fixture.cases) {
  const problems: string[] = [];
  try {
    const row = songRowFromInput(expand(c.input) as never, fixture.owner) as unknown as Record<string, unknown>;
    if (c.error) {
      problems.push(`the contract says refuse (${c.error.field}, ${c.error.status}) but it produced a row`);
    } else {
      problems.push(...differences(c.row, row));
    }
  } catch (err) {
    if (!c.error) {
      problems.push(`the contract expects a row but it refused — ${(err as Error).message}`);
    } else if (!(err instanceof ApiError)) {
      problems.push(`refused with ${(err as Error).name}, not ApiError`);
    } else {
      if (err.status !== c.error.status) problems.push(`status ${err.status}, contract says ${c.error.status}`);
      if (err.field !== c.error.field) problems.push(`field "${err.field}", contract says "${c.error.field}"`);
      if (c.error.says && !err.message.includes(c.error.says)) {
        problems.push(`"${err.message}" does not say "${c.error.says}"`);
      }
    }
  }
  check(c.name, problems);
}

console.log("\n\x1b[1mWhat the mirror makes of a stored row\x1b[0m");
for (const c of fixture.songRows) {
  const song = songFromRow({ ...c.row, ownerHandle: c.ownerHandle } as unknown as SongRow) as unknown as Record<string, unknown>;
  check(c.name, differences(c.song, song));
}

/* The same rows through the mapper the Edge Functions use. Two mappers, one fixture:
   the browser's road and the function's road have to produce the same object. */
console.log("\n\x1b[1mWhat the function makes of the same row\x1b[0m");
for (const c of fixture.songRows) {
  const song = songFromRowInFunction(c.row as never, c.ownerHandle) as unknown as Record<string, unknown>;
  check(`${c.name} — through the function`, differences(c.song, song));
}

console.log(`\n\x1b[1mResult\x1b[0m`);
console.log(`  ${checks - failures.length}/${checks} cases agreed with the contract`);
if (failures.length) {
  console.log(`\n${red(`${failures.length} disagreement${failures.length === 1 ? "" : "s"}:`)}`);
  for (const failure of failures) console.log(`  ${red("✗")} ${failure}`);
  process.exit(1);
}
console.log(`  ${green("the browser's validator and the function's validator are the same validator")}`);
