-- CoolNasheed · core schema
--
-- Everything lives in Postgres. That is the point of using Supabase rather than a
-- server of our own: the database is the backend, Row Level Security is the access
-- control, and the only code that runs is the handful of Edge Functions that genuinely
-- need a server (see supabase/functions).
--
-- Free-tier decisions, all of them deliberate:
--   • counters (songs.plays, songs.likes, comments.amens) are maintained by triggers,
--     so a list of twenty nasheeds is one indexed query rather than twenty aggregates
--   • plays are written to play_events *and* rolled up into song_stats_daily in the
--     same call, so charts read a table of ~24×30 rows instead of every listen ever
--   • play_events is pruned after 90 days by a scheduled job; the rollups are kept,
--     which is what the charts actually need
--   • ids are text, not uuid, for songs/comments/collections: a shareable URL that says
--     /t/sng_talaa-al-badru beats one that says /t/7f3c… and costs nothing to store
--   • arrays (tags, song_ids, lines as jsonb) instead of join tables where the data is
--     read as a whole and written by one owner — fewer rows, fewer joins, same integrity

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

/* -------------------------------------------------------------------- people */

-- A profile is a publisher identity. When somebody signs up through Supabase Auth the
-- trigger below creates their row with the same id as their auth user, so
-- `profiles.id = auth.uid()` is the ownership test everywhere. `kind` is what
-- separates the two: an `artist` is a publisher identity in the catalogue, a
-- `listener` is somebody who can sign in. Both are rows in the same table.
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  handle      text not null,
  name        text not null,
  name_ar     text,
  -- what they do, e.g. "voice, no instruments" — shown on a publisher page
  tagline     text not null default '',
  bio         text not null default '',
  city        text not null default '',
  seed        text not null default '',
  role        text not null default 'listener'
              check (role in ('listener','staff')),
  kind        text not null default 'listener'
              check (kind in ('listener','artist')),
  verified    boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint handle_shape check (handle ~ '^[a-z0-9._]{3,20}$'),
  constraint name_shape check (char_length(name) between 2 and 48),
  constraint tagline_shape check (char_length(tagline) <= 120),
  constraint bio_shape check (char_length(bio) <= 280)
);

create unique index if not exists profiles_handle_key on public.profiles (handle);
create index if not exists profiles_kind_idx on public.profiles (kind);

-- handles belonging to the catalogue itself, so nobody can impersonate a reciter
create table if not exists public.reserved_handles (
  handle text primary key
);

insert into public.reserved_handles (handle) values
  ('coolnasheed'),('nur'),('admin'),('root'),('staff'),('system')
on conflict do nothing;

/* --------------------------------------------------------------------- songs */

create table if not exists public.songs (
  id            text primary key default ('sng_' || substr(gen_random_uuid()::text, 1, 18)),
  owner_id      uuid references public.profiles (id) on delete cascade,
  title         text not null,
  title_ar      text,
  note          text not null default '',
  -- the maqām it is sung in: the one piece of musical metadata a listener
  -- actually browses by, so it stays even though nothing synthesizes it
  maqam         text not null
                check (maqam in ('rast','bayati','hijaz','nahawand','kurd','ajam','saba','nikriz','hijazkar','ushshaq')),
  year          integer check (year between 600 and 2200),
  tags          text[] not null default '{}',
  -- [{tr,ar,en,note,t?}] — the lyrics, with `t` in seconds when the publisher
  -- supplied timings, which is what the karaoke view syncs to
  lines         jsonb not null default '[]'::jsonb,
  -- storage paths, not URLs: /storage/v1/object/public/nasheed-audio/<path>
  audio_path    text,
  audio_mime    text,
  audio_bytes   bigint,
  duration_ms   integer check (duration_ms is null or duration_ms between 1000 and 86400000),
  artwork_path  text,
  status        text not null default 'live' check (status in ('live','removed')),
  published_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  -- denormalised counters, maintained by triggers further down
  plays         integer not null default 0,
  likes         integer not null default 0,
  notes         integer not null default 0,
  constraint title_shape check (char_length(title) between 2 and 120),
  constraint note_shape check (char_length(note) <= 480),
  constraint tags_shape check (array_length(tags, 1) is null or array_length(tags, 1) <= 8),
  constraint lines_shape check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 0 and 40)
);

create index if not exists songs_owner_idx on public.songs (owner_id);
create index if not exists songs_live_new_idx on public.songs (published_at desc) where status = 'live';
create index if not exists songs_live_plays_idx on public.songs (plays desc) where status = 'live';
create index if not exists songs_tags_idx on public.songs using gin (tags);
create index if not exists songs_title_trgm_idx on public.songs using gin (title extensions.gin_trgm_ops);

/* --------------------------------------------------------------- collections */

create table if not exists public.collections (
  id          text primary key default ('col_' || substr(gen_random_uuid()::text, 1, 18)),
  kind        text not null default 'album' check (kind in ('album','mukhtarat','mix')),
  title       text not null,
  title_ar    text,
  curator     text not null default 'CoolNasheed',
  blurb       text not null default '',
  seed        text not null default '',
  tags        text[] not null default '{}',
  year        integer,
  -- ordered ids rather than a join table: a shelf is read whole and written by staff
  song_ids    text[] not null default '{}',
  owner_id    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint collection_title_shape check (char_length(title) between 2 and 160)
);

create index if not exists collections_kind_idx on public.collections (kind);

/* ------------------------------------------------------------------- social */

create table if not exists public.comments (
  id           text primary key default ('cmt_' || substr(gen_random_uuid()::text, 1, 18)),
  song_id      text not null references public.songs (id) on delete cascade,
  author_id    uuid not null references public.profiles (id) on delete cascade,
  text         text not null,
  at_line      integer check (at_line is null or at_line between 1 and 400),
  edited_at    timestamptz,
  amens        integer not null default 0,
  reports      integer not null default 0,
  -- hidden by its author or by moderation, kept so the thread does not renumber
  removed      boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint comment_text_shape check (char_length(text) between 1 and 600)
);

create index if not exists comments_song_idx on public.comments (song_id, created_at desc);
create index if not exists comments_author_idx on public.comments (author_id);

create table if not exists public.loves (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  song_id     text not null references public.songs (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (profile_id, song_id)
);
create index if not exists loves_song_idx on public.loves (song_id);

create table if not exists public.amens (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  comment_id  text not null references public.comments (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (profile_id, comment_id)
);

create table if not exists public.follows (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  artist_id   uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (profile_id, artist_id),
  constraint no_self_follow check (profile_id <> artist_id)
);
create index if not exists follows_artist_idx on public.follows (artist_id);

create table if not exists public.playlists (
  id          text primary key default ('ply_' || substr(gen_random_uuid()::text, 1, 18)),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null,
  blurb       text not null default '',
  seed        text not null default '',
  song_ids    text[] not null default '{}',
  created_at  timestamptz not null default now(),
  constraint playlist_name_shape check (char_length(name) between 1 and 80),
  constraint playlist_size check (coalesce(array_length(song_ids, 1), 0) <= 500)
);
create index if not exists playlists_owner_idx on public.playlists (owner_id);

create table if not exists public.saved_collections (
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  collection_id  text not null references public.collections (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (profile_id, collection_id)
);

create table if not exists public.reports (
  id            text primary key default ('rpt_' || substr(gen_random_uuid()::text, 1, 18)),
  comment_id    text not null references public.comments (id) on delete cascade,
  reporter_id   uuid not null references public.profiles (id) on delete cascade,
  reason        text not null,
  resolved      boolean not null default false,
  resolved_at   timestamptz,
  -- denormalised so the moderation queue reads without three joins
  comment_text  text not null default '',
  author_handle text not null default '',
  song_id       text not null default '',
  song_title    text not null default '',
  created_at    timestamptz not null default now(),
  constraint report_reason_shape check (char_length(reason) between 3 and 300)
);
create index if not exists reports_open_idx on public.reports (created_at desc) where resolved = false;

/* ---------------------------------------------------------------- analytics */

-- One row per listen. This is the only table that grows without bound, so it is the
-- only one with a retention job; the rollups below are what survive.
create table if not exists public.play_events (
  id          bigint generated always as identity primary key,
  song_id     text not null references public.songs (id) on delete cascade,
  profile_id  uuid references public.profiles (id) on delete set null,
  -- anonymous device id, so "listeners" counts people rather than page loads
  client_id   text,
  seconds     integer not null default 0 check (seconds between 0 and 21600),
  completed   boolean not null default false,
  day         date not null default (now() at time zone 'utc')::date,
  created_at  timestamptz not null default now()
);
create index if not exists play_events_song_day_idx on public.play_events (song_id, day desc);
create index if not exists play_events_day_idx on public.play_events (day desc);
create index if not exists play_events_profile_idx on public.play_events (profile_id) where profile_id is not null;

create table if not exists public.song_stats_daily (
  song_id     text not null references public.songs (id) on delete cascade,
  day         date not null,
  plays       integer not null default 0,
  listeners   integer not null default 0,
  seconds     bigint not null default 0,
  primary key (song_id, day)
);
create index if not exists song_stats_day_idx on public.song_stats_daily (day desc);

create table if not exists public.site_stats_daily (
  day         date primary key,
  plays       integer not null default 0,
  listeners   integer not null default 0,
  signups     integer not null default 0
);

/* ------------------------------------------------------------------ helpers */

-- staff check used by policies; security definer so a policy can ask without the
-- caller needing read access to other people's profiles
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role = 'staff' from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

grant execute on function public.is_staff() to anon, authenticated;

/* --------------------------------------------------------------- auth trigger */

-- Supabase Auth owns credentials; this gives every new user a profile in the same
-- transaction, with a handle derived from their email or their chosen one.
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wanted text;
  base text;
  final text;
  n integer := 0;
  v_role text := 'listener';
begin
  wanted := lower(coalesce(
    new.raw_user_meta_data ->> 'handle',
    split_part(coalesce(new.email, 'listener'), '@', 1)
  ));
  wanted := regexp_replace(wanted, '[^a-z0-9._]', '', 'g');
  if char_length(wanted) < 3 then
    wanted := 'listener' || substr(new.id::text, 1, 6);
  end if;
  base := left(wanted, 20);
  final := base;

  while exists (select 1 from public.profiles where handle = final)
     or exists (select 1 from public.reserved_handles where handle = final)
  loop
    n := n + 1;
    final := left(base, 16) || lpad(n::text, 4, '0');
  end loop;

  -- a brand-new project has no staff at all: the first account gets it, which is how
  -- you into the moderation queue and the dashboard without touching the SQL editor.
  -- the role is decided before the insert, because the profile guard would put it
  -- back on an update — there is nobody signed in yet for it to recognise as staff
  if not exists (select 1 from public.profiles where role = 'staff') then
    v_role := 'staff';
  end if;

  insert into public.profiles (id, handle, name, seed, city, kind, role)
  values (
    new.id,
    final,
    left(coalesce(new.raw_user_meta_data ->> 'name', final), 48),
    'listener-' || final || '-' || substr(new.id::text, 1, 8),
    left(coalesce(new.raw_user_meta_data ->> 'city', ''), 60),
    'listener',
    v_role
  );

  insert into public.site_stats_daily (day, signups)
  values ((now() at time zone 'utc')::date, 1)
  on conflict (day) do update set signups = public.site_stats_daily.signups + 1;

  return new;
end;
$$;

-- a project that already followed the Supabase docs may have a trigger by this name
drop trigger if exists on_auth_user_created on auth.users;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_profile();

/* --------------------------------------------------------- counter triggers */

create or replace function public.bump_song_likes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.songs set likes = likes + 1 where id = new.song_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.songs set likes = greatest(likes - 1, 0) where id = old.song_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists loves_counter on public.loves;
create trigger loves_counter
  after insert or delete on public.loves
  for each row execute function public.bump_song_likes();

create or replace function public.bump_song_notes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and not new.removed then
    update public.songs set notes = notes + 1 where id = new.song_id;
    return new;
  elsif tg_op = 'DELETE' and not old.removed then
    update public.songs set notes = greatest(notes - 1, 0) where id = old.song_id;
    return old;
  elsif tg_op = 'UPDATE' and new.removed <> old.removed then
    if new.removed then
      update public.songs set notes = greatest(notes - 1, 0) where id = new.song_id;
    else
      update public.songs set notes = notes + 1 where id = new.song_id;
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists comments_counter on public.comments;
create trigger comments_counter
  after insert or delete or update of removed on public.comments
  for each row execute function public.bump_song_notes();

create or replace function public.bump_comment_amens()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.comments set amens = amens + 1 where id = new.comment_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.comments set amens = greatest(amens - 1, 0) where id = old.comment_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists amens_counter on public.amens;
create trigger amens_counter
  after insert or delete on public.amens
  for each row execute function public.bump_comment_amens();

create or replace function public.bump_comment_reports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.comments set reports = reports + 1 where id = new.comment_id;
    -- three reports is enough to stop the note being shown while staff look at it.
    -- the counter is already the new one at this point, so this reads `reports >= 3`
    -- and not `reports + 1 >= 3` — that off-by-one hid notes at two reports.
    -- the comment guard would otherwise put `removed` back, because inside this
    -- definer trigger the caller is the person who reported it, not a member of staff
    perform public.guard_bypass('three reports');
    update public.comments set removed = true
      where id = new.comment_id and reports >= 3 and not removed;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists reports_counter on public.reports;
create trigger reports_counter
  after insert on public.reports
  for each row execute function public.bump_comment_reports();

/* ------------------------------------------------------- write-time guards */

-- RLS says *which rows* you may write; these say *which columns* you may change, so
-- nobody can promote themselves to staff. Counters are not guarded here at all —
-- they are protected by column privileges instead, further down in the RLS
-- migration. The reason is that a BEFORE UPDATE trigger cannot tell a client from
-- the security-definer trigger that maintains the numbers: both arrive as an update,
-- and `auth.uid()` inside a definer function is still whoever called it. Guarding a
-- column that a trigger owns means the trigger's work is silently undone, which is
-- the worst failure there is — a counter that looks maintained and is not.

-- The one column a guard does own and a definer path also writes (`comments.removed`,
-- hidden at three reports) needs a way to say "this is the trigger, not a client".
-- It says so transaction-locally, and no client can reach the function that sets it:
-- execute is revoked from anon and authenticated below.
create or replace function public.guard_bypass(reason text)
returns void
language sql
as $$
  select set_config('coolnasheed.guard', left(coalesce(reason, 'definer'), 40), true)
$$;

create or replace function public.guard_bypassed()
returns boolean
language sql
stable
as $$
  select coalesce(nullif(current_setting('coolnasheed.guard', true), ''), '') <> ''
$$;

revoke execute on function public.guard_bypass(text) from public, anon, authenticated;
grant execute on function public.guard_bypassed() to anon, authenticated;
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_staff() and old.role is distinct from new.role then
    return new; -- staff may change roles, including their own
  end if;
  new.role := old.role;
  new.kind := old.kind;
  new.verified := old.verified;
  new.created_at := old.created_at;
  new.handle := lower(new.handle);
  if new.handle ~ '[^a-z0-9._]' or char_length(new.handle) not between 3 and 20 then
    raise exception 'That handle is not allowed.' using errcode = '23514';
  end if;
  if exists (select 1 from public.reserved_handles where handle = new.handle) and new.handle <> old.handle then
    raise exception 'That handle belongs to the catalogue itself.' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

create or replace function public.guard_song_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id
     and not (public.is_staff() or old.owner_id is null) then
    raise exception 'A nasheed cannot change hands.' using errcode = '42501';
  end if;
  if new.id <> old.id then
    raise exception 'A nasheed id cannot change.' using errcode = '42501';
  end if;
  -- plays, likes, notes and the two timestamps are not writable by anon or
  -- authenticated at all (column privileges, in the RLS migration), so there is
  -- nothing to undo here — and undoing it is what would break the counter triggers
  return new;
end;
$$;

drop trigger if exists songs_guard on public.songs;
create trigger songs_guard
  before update on public.songs
  for each row execute function public.guard_song_columns();

create or replace function public.guard_comment_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- the author may edit the words; only staff, and the three-reports trigger which
  -- announces itself, may take the note off the page
  if new.removed and not old.removed and not public.is_staff() and not public.guard_bypassed() then
    new.removed := false;
    new.text := old.text;
    return new;
  end if;
  if new.author_id <> old.author_id or new.song_id <> old.song_id or new.id <> old.id then
    raise exception 'A note cannot move.' using errcode = '42501';
  end if;
  -- amens, reports and created_at are not writable columns for a client; edited_at is
  -- stamped here so an edit cannot claim it never happened
  if not public.is_staff() and new.text is distinct from old.text then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists comments_guard on public.comments;
create trigger comments_guard
  before update on public.comments
  for each row execute function public.guard_comment_columns();
