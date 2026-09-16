/**
 * Build and run the headless smoke test.
 *
 * The harness is wired to a Supabase project that does not exist, on purpose: the
 * client is configured, so it genuinely tries to reach a backend and has to fail in
 * words. That is the case worth testing — an unconfigured build skips every network
 * path there is.
 *
 *   node scripts/smoke.mjs
 */

import { build } from "esbuild";

await build({
  entryPoints: ["scripts/smoke.tsx"],
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".css": "empty" },
  external: ["jsdom"],
  outfile: "node_modules/.tmp/smoke.cjs",
  logLevel: "warning",
});

const { default: path } = await import("node:path");
const { pathToFileURL } = await import("node:url");
await import(pathToFileURL(path.resolve("node_modules/.tmp/smoke.cjs")).href);
