#!/usr/bin/env node
/**
 * One command between an empty Supabase project and a working CoolNasheed.
 *
 *   npm run setup                       the whole schema, using whatever it can find
 *   npm run setup -- --no-seed          the same, minus the (empty) seed file
 *   npm run setup -- --functions        set the secret, deploy the six Edge Functions, call them back
 *   npm run setup -- --dry-run          say what it would do, touch nothing
 *
 * It needs one of two ways in, and will tell you which one it is missing:
 *
 *   SUPABASE_DB_URL        the connection string from Project Settings → Database.
 *                          Everything happens over one Postgres connection: every
 *                          migration in supabase/migrations/, the seed, and the
 *                          verification queries. This is the route to use if you have
 *                          the database password.
 *
 *   SUPABASE_ACCESS_TOKEN  a personal access token (sbp_…) from Account → Access Tokens.
 *                          The SQL goes to Supabase's Management API instead, and the
 *                          same token is what lets `--functions` deploy.
 *
 * Neither is in the repository and neither belongs in `.env` if this is going anywhere
 * public: pass them inline (`npm run setup -- --db-url=postgres://…`) or export them for
 * one shell. The publishable key in `.env` is a different thing — it is public by design.
 *
 * What it will not do is guess. If it cannot reach the project it says so and stops, and
 * if it can reach it but has no way to run SQL, it prints the two commands that would
 * give it one, plus the file to paste into Studio if you would rather not.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const ROOT = process.cwd();

/* Read the folder, never a remembered list. A hard-coded list of the migrations that
   existed when this script was written is how a project ends up with an old schema and a
   command that says it succeeded: migration 5 was added, this array was not, and `npm run
   setup` — which is what the app tells people to run — applied four of the five. The
   directory is the source of truth, in name order, which is timestamp order. */
const MIGRATIONS = readdirSync(join(ROOT, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => join(ROOT, "supabase/migrations", name));
const SEED = join(ROOT, "supabase/seed.sql");

/* ------------------------------------------------------------------- terminal */

const colour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (colour ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const bold = paint("1");
const dim = paint("2");
const green = paint("32");
const red = paint("31");
const amber = paint("33");

const ok = (label, detail = "") => console.log(`  ${green("✓")} ${label}${detail ? dim(` — ${detail}`) : ""}`);
const no = (label, detail = "") => console.log(`  ${red("✗")} ${label}${detail ? dim(` — ${detail}`) : ""}`);
const warn = (label, detail = "") => console.log(`  ${amber("!")} ${label}${detail ? dim(` — ${detail}`) : ""}`);
const step = (title) => console.log(`\n${bold(title)}`);
const mask = (value) => (!value ? "—" : `${value.slice(0, 14)}…${value.slice(-4)}`);

/* ------------------------------------------------------------------ arguments */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

if (flag("help") || flag("h")) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n/, "").replace(/^\/\*\*\n/, ""));
  process.exit(0);
}

const dryRun = flag("dry-run");
const wantSeed = !flag("no-seed");
const wantFunctions = flag("functions");

/* ------------------------------------------------------------------ the .env */

function readDotEnv() {
  const path = join(ROOT, ".env");
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const dotEnv = readDotEnv();
const env = (name) => process.env[name] || dotEnv[name] || "";

const url = (env("VITE_SUPABASE_URL") || "").replace(/\/+$/, "");
const publishableKey = env("VITE_SUPABASE_ANON_KEY");
const secretKey = env("SUPABASE_SECRET_KEY");
const accessToken = option("token") || env("SUPABASE_ACCESS_TOKEN");
const dbUrl = option("db-url") || env("SUPABASE_DB_URL");

const projectRef = (() => {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
})();

/* --------------------------------------------------------------- what went wrong */

class SetupError extends Error {
  constructor(message, hint = "") {
    super(message);
    this.hint = hint;
  }
}

/* ------------------------------------------------------------------- REST probes */

/**
 * The publishable key is enough to ask the project what it has: a missing table
 * answers `PGRST205`, a table hidden by Row Level Security answers `42501`, and a
 * table you may read answers 200. All three are information.
 */
async function probe(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (res.ok) return { state: "there", rows: Array.isArray(body) ? body.length : 0 };
  const code = body?.code ?? "";
  if (code === "PGRST205" || code === "42P01") return { state: "missing", detail: body?.message ?? text.slice(0, 90) };
  if (code === "42501") return { state: "there", rows: 0, detail: "readable only through its policies" };
  if (res.status === 401 || res.status === 403) return { state: "unknown", detail: `${res.status} — the publishable key was refused` };
  return { state: "unknown", detail: `${res.status} ${body?.message ?? text.slice(0, 90)}` };
}

/** How many rows a public table holds, from the Content-Range header alone. */
async function count(table, filter = "") {
  const res = await fetch(`${url}/rest/v1/${table}?select=id${filter}&limit=1`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}`, Prefer: "count=exact", Range: "0-0" },
  });
  if (!res.ok) return null;
  const range = res.headers.get("content-range") ?? "";
  const total = range.split("/")[1];
  return total && total !== "*" ? Number(total) : null;
}

/**
 * A deployed function is only deployed if it answers. These two are the ones a browser
 * calls with no account, so they are called here exactly that way: the publishable key
 * in `apikey` and in `Authorization`, no session, no cookies. What comes back is the
 * proof, and what comes back wrong is printed with the command that fixes it.
 */
async function callFunction(name) {
  const res = await fetch(`${url}/functions/v1/${name}`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text: text.slice(0, 160) };
}

async function askTheFunctions() {
  const health = await callFunction("health");
  if (health.status === 200 && health.body?.checks) {
    const c = health.body.checks;
    const marks = ["database", "storage", "auth"]
      .map((k) => `${k} ${c[k] ? green("✓") : red("✗")}`)
      .join(" · ");
    ok("health answers", `${health.body.counts?.songs ?? 0} nasheeds · ${marks}`);
  } else if (health.status === 401 || health.status === 403) {
    warn("health refused the publishable key", `${health.status} — it is behind JWT verification:

    npx supabase functions deploy health --no-verify-jwt --project-ref ${projectRef}`);
  } else {
    warn("health did not answer", `${health.status} ${health.text}`);
  }

  const catalog = await callFunction("catalog");
  if (catalog.status === 200 && Array.isArray(catalog.body?.songs)) {
    ok("catalog answers", `${catalog.body.songs.length} nasheeds · ${catalog.body.artists?.length ?? 0} publishers · ${catalog.body.collections?.length ?? 0} collections${catalog.body.songs.length ? "" : " · an empty catalogue, which is what a new project has"}`);
  } else if (catalog.status === 401 || catalog.status === 403) {
    warn("catalog refused the publishable key", `${catalog.status}:

    npx supabase functions deploy catalog --no-verify-jwt --project-ref ${projectRef}`);
  } else {
    warn("catalog did not answer", `${catalog.status} ${catalog.text}`);
  }
}

/* ---------------------------------------------------------------- the two roads */

/**
 * Road one: a Postgres connection. One client, every statement, and the verification
 * queries at the end. Supabase's transaction pooler (port 6543) is for short queries
 * from serverless functions; DDL wants the session connection on 5432, so a pooler URL
 * is rewritten and the rewrite is reported rather than done quietly.
 */
async function openPg(connectionString) {
  const { default: pg } = await import("pg");
  let target = connectionString;
  let note = "";
  if (/:6543\b/.test(target) || target.includes("pooler.supabase.com")) {
    target = target
      .replace(/@[^/]*pooler\.supabase\.com:6543/, `@db.${projectRef}.supabase.co:5432`)
      .replace(/:6543\b/, ":5432");
    note = "rewritten from the transaction pooler to the session connection (DDL wants 5432)";
  }
  const client = new pg.Client({ connectionString: target, ssl: { rejectUnauthorized: false }, statement_timeout: 120_000 });
  await client.connect();
  return {
    kind: "a Postgres connection",
    note,
    run: async (sqlText) => {
      await client.query(sqlText);
    },
    value: async (sqlText) => {
      const { rows } = await client.query(sqlText);
      return rows[0] ? Object.values(rows[0])[0] : null;
    },
    close: () => client.end().catch(() => {}),
  };
}

/**
 * Road two: Supabase's Management API, with a personal access token. The host is
 * overridable so this script can be tested against a stub without a project.
 */
async function openManagement(token) {
  const apiHost = (env("SUPABASE_MANAGEMENT_URL") || "https://api.supabase.com").replace(/\/+$/, "");
  const endpoint = `${apiHost}/v1/projects/${projectRef}/database/query`;
  const call = async (query) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 300);
      try {
        message = JSON.parse(text)?.message ?? message;
      } catch {
        /* keep the raw text */
      }
      throw new SetupError(`the Management API answered ${res.status}`, message);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  // fail early and loudly if the token is not a token
  await call("select 1");
  return {
    kind: "the Supabase Management API",
    note: "",
    run: async (sqlText) => {
      await call(sqlText);
    },
    value: async (sqlText) => {
      const rows = await call(sqlText);
      return Array.isArray(rows) && rows[0] ? Object.values(rows[0])[0] : null;
    },
    close: async () => {},
  };
}

/** The paste-it-yourself alternative, described with the file's real size. */
function bundleHint() {
  const path = join(ROOT, "supabase/setup.sql");
  if (!existsSync(path)) return "supabase/setup.sql (run `npm run sql:bundle` first — every migration in one file)";
  const kb = Math.round(readFileSync(path, "utf8").length / 1024);
  return `supabase/setup.sql (${kb} KB — all ${MIGRATIONS.length} migrations in one file, safe to run twice)`;
}

/* ------------------------------------------------------------------------ main */

async function main() {
  console.log(`\n${bold("CoolNasheed · setup")}`);

  if (!url || !publishableKey) {
    no("no project to set up");
    console.log(dim(`
  Put these in .env (Project Settings → API Keys):

    VITE_SUPABASE_URL=https://<your-ref>.supabase.co
    VITE_SUPABASE_ANON_KEY=<the publishable key>

  .env.example has the whole list. The publishable key is public by design — Row Level
  Security decides what it may do. The secret key never goes in .env or in the bundle.`));
    process.exit(1);
  }

  console.log(`  project   ${bold(projectRef)} ${dim(url)}`);
  console.log(`  key       ${dim(mask(publishableKey))} ${publishableKey.startsWith("sb_publishable") ? dim("(new-style publishable)") : dim("(legacy anon)")}`);

  /* 1. is the project reachable, and what does it already have? -------------- */
  step("1 · what the project has now");
  let reach;
  try {
    reach = await probe("songs");
    if (reach.state === "missing") no("public.songs does not exist yet", reach.detail);
    else if (reach.state === "there") ok("public.songs is there", `${(await count("songs")) ?? "?"} nasheeds`);
    else warn("cannot tell whether public.songs is there", reach.detail);
  } catch (err) {
    reach = { state: "unreachable" };
    const ref = projectRef || "<ref>";
    no(`cannot reach ${projectRef}.supabase.co`, String(err?.message ?? err).split("\n")[0]);
    console.log(dim(`
  This script has to run somewhere that can see your project. If you are reading this
  inside a sandboxed workspace, run it on your own machine instead:

    git clone https://github.com/ponksebti-cmd/coolnasheed
    cd coolnasheed && git checkout arena/01a09da5-coolnasheed && npm install
    npm run setup -- --db-url="postgres://postgres.${ref}:<password>@db.${ref}.supabase.co:5432/postgres"

  or, with a personal access token from Account → Access Tokens (no database password,
  and the only route that can deploy the Edge Functions):

    npm run setup -- --token=sbp_… --functions`));
    process.exit(1);
  }

  /* 2. pick a road ----------------------------------------------------------- */
  step("2 · how the SQL will get there");
  let runner = null;
  if (dryRun) {
    warn("dry run — nothing will be written");
    console.log(dim(`  would apply ${MIGRATIONS.length} migrations${wantSeed ? " + the seed" : ""} by ${dbUrl ? "a Postgres connection" : accessToken ? "the Management API" : "…no route given"}`));
  } else if (dbUrl) {
    try {
      runner = await openPg(dbUrl);
      ok("connected over Postgres", runner.note || `db.${projectRef}.supabase.co`);
    } catch (err) {
      no("the database connection refused", String(err?.message ?? err).split("\n")[0]);
      console.log(dim("  Check the password, and that the host is db.<ref>.supabase.co:5432 (Project Settings → Database)."));
      process.exit(1);
    }
  } else if (accessToken) {
    try {
      runner = await openManagement(accessToken);
      ok("connected to the Management API", `token ${mask(accessToken)}`);
    } catch (err) {
      no("the Management API refused", err?.hint || String(err?.message ?? err).split("\n")[0]);
      console.log(dim("  A personal access token starts with sbp_ — Account → Access Tokens. The project's API keys will not do."));
      process.exit(1);
    }
  } else {
    warn("no way in — this needs one credential");
    console.log(dim(`
  Either, from Project Settings → Database (connection string, tab "URI"):

    npm run setup -- --db-url="postgres://postgres.${projectRef}:<password>@db.${projectRef}.supabase.co:5432/postgres"

  Or, from Account → Access Tokens (a personal token, sbp_…):

    npm run setup -- --token=sbp_…

  Or skip this script entirely: open Supabase Studio → SQL Editor → New query, paste
  ${bundleHint()} and press Run. It is safe to run twice.`));
    process.exit(1);
  }

  /* 3. apply ---------------------------------------------------------------- */
  step(`3 · applying the schema${wantSeed ? " and the catalogue" : ""}`);
  if (!dryRun && runner) {
    let failed = false;
    for (const file of MIGRATIONS) {
      const name = file.split("/").pop();
      if (!existsSync(file)) {
        no(name, "missing — run `npm run sql:bundle`?");
        failed = true;
        break;
      }
      try {
        await runner.run(readFileSync(file, "utf8"));
        ok(name);
      } catch (err) {
        no(name, String(err?.hint ?? err?.message ?? err).split("\n")[0]);
        failed = true;
        break;
      }
    }

    if (!failed && wantSeed) {
      try {
        await runner.run(readFileSync(SEED, "utf8"));
        const songs = await runner.value("select count(*)::int from public.songs");
        const publishers = await runner.value("select count(*)::int from public.profiles where kind = 'artist'");
        /* The seed is a file with a notice in it: the catalogue is what people upload, and
           a fresh project having nothing in it is the correct state, not a gap. */
        ok("supabase/seed.sql", songs || publishers
          ? `${songs} nasheeds · ${publishers} publishers`
          : "nothing to seed — the catalogue is what people upload");
      } catch (err) {
        no("supabase/seed.sql", String(err?.hint ?? err?.message ?? err).split("\n")[0]);
        failed = true;
      }
    }
    if (failed) {
      await runner.close();
      process.exit(1);
    }
  }

  /* 4. verify --------------------------------------------------------------- */
  step("4 · verifying from the outside, with the key the app uses");
  if (!dryRun) {
    const after = await probe("songs");
    if (after.state !== "there") {
      no("public.songs still is not readable", after.detail ?? after.state);
    } else {
      const songs = await count("songs");
      const publishers = await count("profiles", "");
      ok(`${songs ?? "?"} nasheeds, ${publishers ?? "?"} profiles`, "readable by the publishable key, through Row Level Security");
    }

    const rpc = await fetch(`${url}/rest/v1/rpc/catalog_payload`, {
      method: "POST",
      headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (rpc.ok) {
      const payload = await rpc.json();
      ok("catalog_payload() answers", `${payload?.songs?.length ?? 0} nasheeds · ${payload?.artists?.length ?? 0} publishers · ${payload?.collections?.length ?? 0} shelves`);
    } else {
      no("catalog_payload() would not answer", `${rpc.status} ${(await rpc.text()).slice(0, 120)}`);
    }

    if (runner) {
      try {
        const buckets = await runner.value("select count(*)::int from storage.buckets where id like 'nasheed-%'");
        const policies = await runner.value("select count(*)::int from pg_policies where schemaname = 'public'");
        ok(`${buckets} storage buckets, ${policies} RLS policies`, "nasheed-audio ≤ 5 MB · nasheed-artwork ≤ 2 MB");
      } catch (err) {
        warn("could not read the storage buckets", String(err?.message ?? err).split("\n")[0]);
      }
    }
  }

  /* 5. functions ------------------------------------------------------------ */
  step("5 · the Edge Functions");
  if (!wantFunctions) {
    console.log(dim(`  skipped. They are optional — every call has a PostgREST road beside it, so the app
  publishes, comments and moderates without them. The one thing that needs a function
  is deleting an account. When you want them:

    npm run setup -- --functions --token=sbp_…      (deploys all six)`));
  } else if (dryRun) {
    warn("dry run — would set the secret key, deploy all six, and call two of them back");
  } else if (!accessToken) {
    warn("deploying needs a personal access token", "npm run setup -- --functions --token=sbp_…");
  } else {
    const cli = ["--yes", "supabase@latest"];
    const cliEnv = { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken };

    /* The secret first. A function that boots without it answers 500 on the one job only
       it can do — deleting an account — and says nothing useful about why. It travels in a
       0600 file rather than in argv, so it lands in no process list and no shell history. */
    if (secretKey) {
      const secretsPath = join(ROOT, "node_modules/.tmp/functions-secrets.env");
      mkdirSync(dirname(secretsPath), { recursive: true });
      writeFileSync(secretsPath, `SUPABASE_SECRET_KEY=${secretKey}\n`, { mode: 0o600 });
      const secrets = spawnSync("npx", [...cli, "secrets", "set", "--env-file", secretsPath, "--project-ref", projectRef], {
        cwd: ROOT,
        stdio: "inherit",
        env: cliEnv,
      });
      rmSync(secretsPath, { force: true });
      if (secrets.status === 0) ok("the secret key is on the project", `${mask(secretKey)} — the functions hold it, the bundle never does`);
      else warn("the secret key did not take", `exit ${secrets.status} — deleting an account stays unavailable until it does:

    npx supabase secrets set SUPABASE_SECRET_KEY=… --project-ref ${projectRef}`);
    } else {
      warn("no SUPABASE_SECRET_KEY to set", "everything works without it except deleting an account, which is the one thing a browser must never be trusted to do");
    }

    /* --use-api bundles server-side. Without it the CLI reaches for Docker, which is a
       dependency this project does not otherwise have and most laptops do not have running. */
    const deploy = spawnSync("npx", [...cli, "functions", "deploy", "--project-ref", projectRef, "--use-api"], {
      cwd: ROOT,
      stdio: "inherit",
      env: cliEnv,
    });
    if (deploy.status !== 0) {
      no("the deploy did not finish", `exit ${deploy.status}`);
    } else {
      ok("six functions deployed", "catalog · analytics · publish · moderate · account · health");
      await askTheFunctions();
    }
  }

  if (runner) await runner.close();

  step("Done");
  console.log(dim(`  The app in this workspace is already pointed at ${projectRef} (.env). Reload it: the
  catalogue now comes from Postgres instead of the bundle, the first account you create
  is staff, and /admin opens.`));
  console.log();
}

main().catch(async (err) => {
  console.log(`\n${red("Setup stopped:")} ${err?.message ?? err}`);
  if (err?.hint) console.log(dim(`  ${err.hint}`));
  process.exit(1);
});
