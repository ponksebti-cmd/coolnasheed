/**
 * What Vite injects at build time.
 *
 * Only two variables exist, and both are public by design: the project URL and the
 * `anon` key. The anon key is not a secret in Supabase — it is the key the browser is
 * meant to hold, and everything it can reach is fenced by Row Level Security. The
 * `service_role` key belongs to the Edge Functions and must never appear here.
 */

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Where the app is served from — `/`, or a subpath. Vite fills this in. */
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
