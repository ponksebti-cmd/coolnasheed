-- ---------------------------------------------------------------------------
--  CoolNasheed · seed
--
--  Empty on purpose. The catalogue is what people upload: a real account signs
--  in, uploads an mp3 in the studio, publishes it, and it appears on the home
--  page. Charts, history and counters are computed from real listens, so they
--  begin at zero — which is what a new catalogue actually looks like.
--
--  There is no generated data anywhere in this repository. Nothing below
--  inserts a row.
--
--  The first account created on a fresh project is made staff by
--  `handle_new_profile()`, which is how you reach /admin without touching SQL.
--
--  Migrations remain in `supabase/migrations/`; this file is kept so
--  `supabase db reset` and the setup bundles keep working unchanged.
-- ---------------------------------------------------------------------------

do $body$
begin
  raise notice 'CoolNasheed: no seed data. The catalogue is what people upload.';
end;
$body$;
