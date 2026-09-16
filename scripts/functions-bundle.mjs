#!/usr/bin/env node
/**
 * The Edge Functions, checked without Deno.
 *
 * `npm run functions:check` is the real thing — `deno check` and `deno test` — but it needs
 * Deno installed, and on most machines (and in most CI images) it is not. That leaves the
 * six functions as the one part of the project nothing verifies, which is how a stale
 * import or a syntax error survives to deploy time.
 *
 * So: bundle each function with the esbuild that is already a dependency, resolving Deno's
 * `npm:` specifier to the installed package. That proves every file parses and every import
 * resolves. It is not type checking, and it does not pretend to be.
 *
 * It also looks for the one bug that cost a real evening: a Postgres row cast straight to
 * `Song`. Postgres answers in snake_case, the app speaks camelCase, and `row as Song` makes
 * `song.ownerId` read as `undefined` — so the ownership test refuses the owner, and
 * `song.audioPath` reads as `undefined`, so editing a nasheed that has a recording is
 * refused with "it needs an mp3". Rows go through `_shared/songs.ts`.
 *
 *   node scripts/functions-bundle.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const ROOT = process.cwd();
const FUNCTIONS = join(ROOT, "supabase/functions");

const everyFile = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? everyFile(path) : [path];
  });

const entries = readdirSync(FUNCTIONS)
  .map((name) => join(FUNCTIONS, name, "index.ts"))
  .filter((path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });

const failures = [];

for (const entry of entries) {
  const name = entry.replace(`${ROOT}/`, "");
  try {
    await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      logLevel: "silent",
      /* Deno imports Supabase from a URL-ish specifier; node_modules has the same code. */
      alias: { "npm:@supabase/supabase-js@2": "@supabase/supabase-js" },
    });
    console.log(`  \x1b[32m✓\x1b[0m ${name} bundles`);
  } catch (err) {
    failures.push(`${name}: ${String(err.message ?? err).split("\n").slice(0, 4).join("\n      ")}`);
    console.log(`  \x1b[31m✗\x1b[0m ${name} does not bundle`);
  }
}

/* The row-cast guard. `as Song` is allowed nowhere: the mapper is the only door. */
const casts = everyFile(FUNCTIONS)
  .filter((path) => path.endsWith(".ts"))
  .flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return [...text.matchAll(/as\s+Song\b/g)].map((m) => ({
      file: path.replace(`${ROOT}/`, ""),
      line: text.slice(0, m.index).split("\n").length,
    }));
  });

if (casts.length) {
  failures.push(
    `a database row is cast to Song at ${casts.map((c) => `${c.file}:${c.line}`).join(", ")} — ` +
      "use songFromRow in _shared/songs.ts, or the next reader reads snake_case as undefined",
  );
  console.log(`  \x1b[31m✗\x1b[0m a row is cast straight to Song instead of mapped`);
} else {
  console.log("  \x1b[32m✓\x1b[0m no row is cast to Song — every row goes through the mapper");
}

if (failures.length) {
  console.log(`\n\x1b[31m${failures.length} problem${failures.length === 1 ? "" : "s"}:\x1b[0m`);
  for (const failure of failures) console.log(`  ${failure}`);
  console.log("\n  the real check, with Deno installed, is `npm run functions:check`");
  process.exit(1);
}

console.log(`\n  ${entries.length} functions parse and resolve their imports.`);
