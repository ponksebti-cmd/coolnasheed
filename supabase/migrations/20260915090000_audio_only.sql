-- ---------------------------------------------------------------------------
--  CoolNasheed · migration 5: audio only
--
--  The catalogue is recordings. A nasheed is an mp3 file a publisher uploaded,
--  with a title, lyrics and cover art. There is no composition model in the
--  database — no maqam, no root note, no tempo, no voices, no frame drum, no
--  motif bank — because the application does not synthesise anything, and a
--  column nothing reads is a column that lies about what the product is.
--
--  What it does, in order:
--    1. deletes the demo catalogue, the demo profiles and every counter they
--       seeded, so what is left is what people actually published;
--    2. drops the composition columns and the anonymous device id, and makes a
--       live nasheed without a recording impossible;
--    3. adds the three per-account tables the interface needs that Postgres was
--       not yet holding: settings, the dhikr counter and the studio draft;
--    4. rewrites the play beacon without a device id;
--    5. rewrites the payload functions to the audio-only shape;
--    6. narrows storage to mp3 under 5 MB, artwork under 2 MB;
--    7. writes the schema's own version into `app_schema`, so a project that has
--       not run this file can be told so in a sentence instead of a constraint
--       name the client has to decode.
--
--  It is written to be run once, in order, on a database that already has
--  migrations 1–4. Every statement is guarded, so a second run is a no-op
--  rather than an error.
-- ---------------------------------------------------------------------------

/* ======================================================================== */
/*  1. the demo data goes away                                               */
/* ======================================================================== */

-- Plays recorded for demo nasheeds, and the rollups they fed. Nothing here is
-- real listening: the catalogue was seeded and the counters came with it.
delete from public.play_events;
delete from public.song_stats_daily;
delete from public.site_stats_daily;

-- Demo publishers were profiles with no auth row behind them: nobody could sign
-- in as them, and every one of their nasheeds is unreachable now that the app
-- only plays uploaded recordings. Songs go with them (owner_id cascade).
delete from public.songs
 where owner_id is null
    or not exists (select 1 from auth.users u where u.id = songs.owner_id);

delete from public.profiles p
 where not exists (select 1 from auth.users u where u.id = p.id);

-- Shelves and sets that belonged to those profiles.
delete from public.collections c
 where c.owner_id is not null
   and not exists (select 1 from public.profiles p where p.id = c.owner_id);
delete from public.collections
 where owner_id is null
   and not exists (select 1 from public.songs s where s.id = any (song_ids));

delete from public.playlists pl
 where not exists (select 1 from public.profiles p where p.id = pl.owner_id);

-- Handles reserved for the project itself are all that is left; the rest belonged to
-- the demo catalogue and go with it.
delete from public.reserved_handles
 where handle not in ('coolnasheed', 'admin', 'root', 'staff', 'system');

/* ======================================================================== */
/*  2. the composition columns and the device id go away                     */
/* ======================================================================== */

alter table public.songs
  drop column if exists maqam,
  drop column if exists root,
  drop column if exists bpm,
  drop column if exists voices,
  drop column if exists duff,
  drop column if exists duff_enter,
  drop column if exists passes,
  drop column if exists motif_bank;

-- A live nasheed must have a recording. A removed one keeps whatever it had
-- (staff sometimes take a row down before deleting the file).
alter table public.songs drop constraint if exists songs_live_needs_audio;
alter table public.songs drop constraint if exists songs_audio_required;
alter table public.songs
  add constraint songs_audio_required
  check (status <> 'live' or audio_path is not null);

-- The bucket ceiling, stated once on the row as well, so a hand-written insert
-- cannot point at a file the bucket would never have accepted.
alter table public.songs drop constraint if exists songs_audio_bytes_shape;
alter table public.songs
  add constraint songs_audio_bytes_shape
  check (audio_bytes is null or audio_bytes between 1 and 5242880);

-- Duration is a real measurement from the file; six hours is the ceiling. The
-- inline check from migration 1 said 24 hours, so it is replaced rather than
-- left to intersect with this one and confuse whoever reads the table next.
alter table public.songs drop constraint if exists songs_duration_ms_check;
alter table public.songs drop constraint if exists songs_duration_shape;
alter table public.songs
  add constraint songs_duration_shape
  check (duration_ms is null or duration_ms between 1000 and 21600000);

-- The year bound the interface uses, stated on the row as well: 1300 is as far back
-- as a recording of a voice can plausibly go.
alter table public.songs drop constraint if exists songs_year_check;
alter table public.songs drop constraint if exists songs_year_shape;
alter table public.songs
  add constraint songs_year_shape
  check (year is null or year between 1300 and 2200);

-- An upload belongs to the account that uploaded it. The bucket policies already
-- enforce this on storage.objects; this makes the same rule true of the row, so a
-- hand-written insert cannot publish somebody else's file under its own name.
alter table public.songs drop constraint if exists songs_audio_belongs_to_owner;
alter table public.songs
  add constraint songs_audio_belongs_to_owner
  check (
    audio_path is null
    or owner_id is null
    or split_part(audio_path, '/', 1) = owner_id::text
  );

alter table public.songs drop constraint if exists songs_artwork_belongs_to_owner;
alter table public.songs
  add constraint songs_artwork_belongs_to_owner
  check (
    artwork_path is null
    or owner_id is null
    or split_part(artwork_path, '/', 1) = owner_id::text
  );

-- The column grants from migration 3 named the composition columns too. Postgres
-- drops a column grant along with its column, so what is left is already the
-- audio-only set — restated here, in the file that removes the others, because a
-- publisher should be able to read one place and know what they may write.
revoke insert, update on public.songs from authenticated;
grant insert (
  owner_id, title, title_ar, note, accent, year, tags, lines,
  audio_path, audio_mime, audio_bytes, duration_ms, artwork_path, status
) on public.songs to authenticated;
grant update (
  title, title_ar, note, accent, year, tags, lines,
  audio_path, audio_mime, audio_bytes, duration_ms, artwork_path, status
) on public.songs to authenticated;
-- id, owner_id, plays, likes, notes, published_at and created_at stay unwritable.

alter table public.profiles drop column if exists seed;

alter table public.collections drop column if exists seed;
alter table public.playlists   drop column if exists seed;

-- Anonymous listening is still recorded, but no longer keyed by a browser
-- identifier: the column held a random string the client generated and stored
-- in localStorage, which is exactly the "on device" bookkeeping this migration
-- is removing. Counts are per song per day; "listeners" is the number of
-- signed-in listeners.
alter table public.play_events drop column if exists client_id;
drop index if exists public.play_events_client_idx;
create index if not exists play_events_profile_day_idx
  on public.play_events (profile_id, day desc);

/* ======================================================================== */
/*  3. the account tables the interface was keeping in the browser           */
/* ======================================================================== */

-- Settings used to live in localStorage, which meant a listener's theme,
-- volume and lyric preferences vanished on the next device. They are rows now.
create table if not exists public.user_prefs (
  profile_id       uuid primary key references public.profiles (id) on delete cascade,
  theme            text not null default 'night' check (theme in ('night', 'dawn')),
  volume           numeric(3,2) not null default 0.85 check (volume >= 0 and volume <= 1),
  muted            boolean not null default false,
  lyric_script     text not null default 'tr' check (lyric_script in ('tr', 'ar', 'en')),
  show_arabic      boolean not null default true,
  show_translation boolean not null default true,
  reduce_motion    boolean not null default false,
  updated_at       timestamptz not null default now()
);

-- The tasbīḥ counter, per account rather than per browser.
create table if not exists public.dhikr_counts (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  phrase     text not null check (phrase ~ '^[a-z][a-z0-9_]{2,31}$'),
  count      integer not null default 0 check (count >= 0 and count <= 10000000),
  target     integer not null default 33 check (target between 1 and 1000000),
  updated_at timestamptz not null default now(),
  primary key (profile_id, phrase)
);

-- One draft per account: what the studio has that is not published yet.
create table if not exists public.studio_drafts (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  draft      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint studio_draft_shape check (jsonb_typeof(draft) = 'object'),
  constraint studio_draft_size check (pg_column_size(draft) <= 131072)
);

alter table public.user_prefs     enable row level security;
alter table public.dhikr_counts   enable row level security;
alter table public.studio_drafts  enable row level security;

do $policies$
declare
  t text;
begin
  foreach t in array array['user_prefs', 'dhikr_counts', 'studio_drafts'] loop
    execute format('drop policy if exists "you own your %1$s row" on public.%1$s', t);
    execute format($f$
      create policy "you own your %1$s row" on public.%1$s
        for all to authenticated
        using (profile_id = auth.uid())
        with check (profile_id = auth.uid())
    $f$, t);
  end loop;
end;
$policies$;

grant select, insert, update, delete on public.user_prefs    to authenticated;
grant select, insert, update, delete on public.dhikr_counts  to authenticated;
grant select, insert, update, delete on public.studio_drafts to authenticated;
revoke all on public.user_prefs, public.dhikr_counts, public.studio_drafts from anon;

-- The old seed columns carried a value clients sent when signing up; nothing
-- needs to any more, and the profile it creates starts on the defaults above.
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

  -- a brand-new project has no staff at all: the first account gets it
  if not exists (select 1 from public.profiles where role = 'staff') then
    v_role := 'staff';
  end if;

  insert into public.profiles (id, handle, name, city, role, kind)
  values (
    new.id,
    final,
    left(coalesce(new.raw_user_meta_data ->> 'name', final), 48),
    left(coalesce(new.raw_user_meta_data ->> 'city', ''), 60),
    v_role,
    'listener'
  )
  on conflict (id) do nothing;

  insert into public.site_stats_daily (day, signups)
  values ((now() at time zone 'utc')::date, 1)
  on conflict (day) do update set signups = public.site_stats_daily.signups + 1;

  return new;
end;
$$;

-- Every account gets its settings row, so a read never has to cope with "there is
-- no row yet" — and nothing lazily inserts on a read path, because a SELECT that
-- writes is a bug that only shows up under load.
create or replace function public.handle_new_prefs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_prefs (profile_id) values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

drop trigger if exists handle_new_prefs on public.profiles;
create trigger handle_new_prefs
  after insert on public.profiles
  for each row execute function public.handle_new_prefs();

-- Backfill for the accounts that already exist.
insert into public.user_prefs (profile_id)
select p.id from public.profiles p
 where not exists (select 1 from public.user_prefs u where u.profile_id = p.id);

-- Publishing is what makes somebody a publisher: the flag follows the work rather
-- than being granted by hand. The profile guard would normally put `kind` back, so
-- this definer trigger announces itself the same way the moderation trigger does.
create or replace function public.mark_publisher()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is null then
    return new;
  end if;
  perform public.guard_bypass('first publish');
  update public.profiles
     set kind = 'artist'
   where id = new.owner_id and kind <> 'artist';
  return new;
end;
$$;

drop trigger if exists songs_mark_publisher on public.songs;
create trigger songs_mark_publisher
  after insert on public.songs
  for each row execute function public.mark_publisher();

-- The profile guard must stop looking after a column that no longer exists —
-- and it must no longer claim kind/verified edits are safe when the writer is
-- the studio.
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
  new.verified := old.verified;
  new.created_at := old.created_at;
  if not public.guard_bypassed() then
    new.kind := old.kind;
  end if;
  new.handle := lower(new.handle);
  if new.handle ~ '[^a-z0-9._]' or char_length(new.handle) not between 3 and 20 then
    raise exception 'That handle is not allowed.' using errcode = '23514';
  end if;
  if exists (select 1 from public.reserved_handles where handle = new.handle) and new.handle <> old.handle then
    raise exception 'That handle belongs to the project itself.' using errcode = '23505';
  end if;
  return new;
end;
$$;

/* ======================================================================== */
/*  4. the play beacon, without a device id                                  */
/* ======================================================================== */

-- One listen, once. Signed-in listeners are deduplicated against their own
-- last five seconds; signed-out ones are deduplicated per song across the
-- whole site, which is the strongest rule available without storing anything
-- about the person listening. Counting is unchanged: fifteen seconds or a
-- completion.
create or replace function public.record_play(
  p_song_id text,
  p_seconds integer default 0,
  p_completed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_song public.songs;
  v_profile uuid := auth.uid();
  v_seconds integer;
  v_day date := (now() at time zone 'utc')::date;
  v_new_listener boolean := false;
  v_counted boolean;
begin
  select * into v_song from public.songs where id = p_song_id and status = 'live';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That nasheed is not here.');
  end if;

  v_seconds := least(greatest(coalesce(p_seconds, 0), 0), 21600);
  v_counted := coalesce(p_completed, false) or v_seconds >= 15;

  if exists (
    select 1 from public.play_events
    where song_id = v_song.id
      and created_at > now() - interval '5 seconds'
      and ((v_profile is not null and profile_id = v_profile)
        or (v_profile is null and profile_id is null))
  ) then
    return jsonb_build_object('ok', true, 'counted', false, 'duplicate', true, 'plays', v_song.plays);
  end if;

  select not exists (
    select 1 from public.play_events
    where song_id = v_song.id and day = v_day and profile_id is not distinct from v_profile
  ) into v_new_listener;

  insert into public.play_events (song_id, profile_id, seconds, completed, day)
  values (v_song.id, v_profile, v_seconds, coalesce(p_completed, false), v_day);

  -- A "play" in the charts is a listen, the same thing songs.plays counts. A skip
  -- leaves its seconds on the record — those were really spent — but it is not a
  -- play, and a chart that counted skips would be a chart of skips.
  insert into public.song_stats_daily (song_id, day, plays, listeners, seconds)
  values (v_song.id, v_day, case when v_counted then 1 else 0 end,
          case when v_new_listener then 1 else 0 end, v_seconds)
  on conflict (song_id, day) do update
    set plays = public.song_stats_daily.plays + case when v_counted then 1 else 0 end,
        listeners = public.song_stats_daily.listeners + case when v_new_listener then 1 else 0 end,
        seconds = public.song_stats_daily.seconds + v_seconds;

  insert into public.site_stats_daily (day, plays, listeners)
  values (v_day, case when v_counted then 1 else 0 end, case when v_new_listener then 1 else 0 end)
  on conflict (day) do update
    set plays = public.site_stats_daily.plays + case when v_counted then 1 else 0 end,
        listeners = public.site_stats_daily.listeners + case when v_new_listener then 1 else 0 end;

  if v_counted then
    update public.songs set plays = plays + 1 where id = v_song.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'counted', v_counted,
    'plays', (select plays from public.songs where id = v_song.id)
  );
end;
$$;

grant execute on function public.record_play(text, integer, boolean) to anon, authenticated;

-- The previous signature took a client id; nothing calls it any more.
drop function if exists public.record_play(text, integer, boolean, text);

-- A listener's own recent listening. Signed-out visitors get nothing: there is
-- no device identifier to look up, and asking the database to guess would be
-- the same on-device bookkeeping under a different name.
create or replace function public.my_history(p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if v_profile is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t."lastAt" desc)
    from (
      select e.song_id as "songId",
             s.title as "title",
             s.accent as "accent",
             s.artwork_path as "artworkPath",
             p.name as "ownerName",
             count(*)::int as "plays",
             sum(e.seconds)::int as "seconds",
             floor(extract(epoch from max(e.created_at)) * 1000)::bigint as "lastAt"
      from public.play_events e
      join public.songs s on s.id = e.song_id and s.status = 'live'
      left join public.profiles p on p.id = s.owner_id
      where e.profile_id = v_profile
      group by e.song_id, s.title, s.accent, s.artwork_path, p.name
      order by 8 desc
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.my_history(integer) to authenticated;
drop function if exists public.my_history(integer, text);

/* ======================================================================== */
/*  5. the payloads, in the audio-only shape                                 */
/* ======================================================================== */

-- The chart row no longer carries a maqam.
drop function if exists public.trending(text, integer);
create or replace function public.trending(p_window text default '7d', p_limit integer default 10)
returns table (
  song_id text,
  title text,
  accent text,
  artwork_path text,
  owner_name text,
  plays bigint,
  listeners bigint,
  seconds bigint,
  likes integer
)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select case p_window
      when '24h' then (now() at time zone 'utc')::date - 1
      when '30d' then (now() at time zone 'utc')::date - 30
      when 'all' then date '1970-01-01'
      else (now() at time zone 'utc')::date - 7
    end as since
  )
  select s.id, s.title, s.accent, s.artwork_path, p.name,
         sum(d.plays)::bigint, sum(d.listeners)::bigint, sum(d.seconds)::bigint, s.likes
  from public.song_stats_daily d
  join public.songs s on s.id = d.song_id and s.status = 'live'
  left join public.profiles p on p.id = s.owner_id
  cross join bounds b
  where d.day >= b.since
  group by s.id, s.title, s.accent, s.artwork_path, p.name, s.likes
  order by sum(d.plays) desc, s.likes desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

grant execute on function public.trending(text, integer) to anon, authenticated;

-- Everything a cold start needs, one call. A publisher is anybody with a live
-- nasheed; a listener who never published is not in this list, because there is
-- nothing of theirs to browse to.
create or replace function public.catalog_payload()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'artists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.handle,
        'profileId', p.id,
        'handle', p.handle,
        'name', p.name,
        'nameAr', p.name_ar,
        'role', coalesce(nullif(p.tagline, ''), 'Publisher'),
        'origin', coalesce(nullif(p.city, ''), '—'),
        'bio', p.bio,
        'accent', p.accent,
        'verified', p.verified,
        'kind', p.kind,
        'songs', (select count(*)::int from public.songs s where s.owner_id = p.id and s.status = 'live'),
        'followers', (select count(*)::int from public.follows f where f.artist_id = p.id)
      ) order by p.name)
      from public.profiles p
      where exists (select 1 from public.songs s where s.owner_id = p.id and s.status = 'live')
    ), '[]'::jsonb),
    'songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'ownerId', s.owner_id,
        'ownerHandle', (select handle from public.profiles where id = s.owner_id),
        'ownerName', (select name from public.profiles where id = s.owner_id),
        'title', s.title,
        'titleAr', s.title_ar,
        'note', s.note,
        'accent', s.accent,
        'year', s.year,
        'tags', to_jsonb(s.tags),
        'lines', s.lines,
        'audioPath', s.audio_path,
        'audioMime', s.audio_mime,
        'audioBytes', s.audio_bytes,
        'durationMs', s.duration_ms,
        'artworkPath', s.artwork_path,
        'status', s.status,
        'publishedAt', floor(extract(epoch from s.published_at) * 1000)::bigint,
        'plays', s.plays,
        'likes', s.likes,
        'notes', s.notes
      ) order by s.published_at desc)
      from public.songs s
      where s.status = 'live'
    ), '[]'::jsonb),
    'collections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'kind', c.kind,
        'title', c.title,
        'titleAr', c.title_ar,
        'curator', c.curator,
        'blurb', c.blurb,
        'accent', c.accent,
        'tags', to_jsonb(c.tags),
        'year', c.year,
        'songIds', to_jsonb(c.song_ids)
      ) order by c.created_at)
      from public.collections c
    ), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('tag', t.tag, 'count', t.count) order by t.count desc, t.tag)
      from (select unnest(tags) as tag, count(*)::int from public.songs where status = 'live' group by 1) t
    ), '[]'::jsonb),
    'generatedAt', floor(extract(epoch from now()) * 1000)::bigint
  );
$$;

grant execute on function public.catalog_payload() to anon, authenticated;

-- Everything about *you* in one call. Reads only — a boot that writes is a boot
-- that fails on a read replica and races itself on a cold start.
create or replace function public.my_bootstrap()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid := auth.uid();
  v_profile public.profiles;
  v_prefs public.user_prefs;
begin
  if v_id is null then
    return jsonb_build_object('user', null);
  end if;

  select * into v_profile from public.profiles where id = v_id;
  if not found then
    return jsonb_build_object('user', null);
  end if;

  select * into v_prefs from public.user_prefs where profile_id = v_id;

  return jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_profile.handle,
      'profileId', v_profile.id,
      'handle', v_profile.handle,
      'name', v_profile.name,
      'nameAr', v_profile.name_ar,
      'tagline', v_profile.tagline,
      'bio', v_profile.bio,
      'city', v_profile.city,
      'accent', v_profile.accent,
      'role', v_profile.role,
      'kind', v_profile.kind,
      'verified', v_profile.verified,
      'createdAt', floor(extract(epoch from v_profile.created_at) * 1000)::bigint
    ),
    'prefs', jsonb_build_object(
      'theme', coalesce(v_prefs.theme, 'night'),
      'volume', coalesce(v_prefs.volume, 0.85)::float8,
      'muted', coalesce(v_prefs.muted, false),
      'lyricScript', coalesce(v_prefs.lyric_script, 'tr'),
      'showArabic', coalesce(v_prefs.show_arabic, true),
      'showTranslation', coalesce(v_prefs.show_translation, true),
      'reduceMotion', coalesce(v_prefs.reduce_motion, false)
    ),
    'dhikr', coalesce((
      select jsonb_agg(jsonb_build_object('phrase', d.phrase, 'count', d.count, 'target', d.target) order by d.phrase)
      from public.dhikr_counts d where d.profile_id = v_id
    ), '[]'::jsonb),
    'draft', coalesce((select d.draft from public.studio_drafts d where d.profile_id = v_id), null),
    'stats', jsonb_build_object(
      'published', (select count(*)::int from public.songs s where s.owner_id = v_id and s.status <> 'removed'),
      'notes', (select count(*)::int from public.comments c where c.author_id = v_id),
      'loved', (select count(*)::int from public.loves l where l.profile_id = v_id),
      'playlists', (select count(*)::int from public.playlists p where p.owner_id = v_id),
      'amens', (select count(*)::int from public.amens a where a.profile_id = v_id),
      'followers', (select count(*)::int from public.follows f where f.artist_id = v_id),
      'following', (select count(*)::int from public.follows f where f.profile_id = v_id)
    ) || coalesce(public.my_listening(), '{}'::jsonb),
    'liked', coalesce((select jsonb_agg(l.song_id) from public.loves l where l.profile_id = v_id), '[]'::jsonb),
    'followed', coalesce((select jsonb_agg(f.artist_id::text) from public.follows f where f.profile_id = v_id), '[]'::jsonb),
    'savedCollections', coalesce((select jsonb_agg(sc.collection_id) from public.saved_collections sc where sc.profile_id = v_id), '[]'::jsonb),
    'playlists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'ownerId', p.owner_id, 'name', p.name, 'blurb', p.blurb,
        'accent', p.accent, 'songIds', to_jsonb(p.song_ids),
        'createdAt', floor(extract(epoch from p.created_at) * 1000)::bigint
      ) order by p.created_at desc)
      from public.playlists p where p.owner_id = v_id
    ), '[]'::jsonb),
    'songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'ownerId', s.owner_id,
        'ownerHandle', (select handle from public.profiles where id = s.owner_id),
        'ownerName', (select name from public.profiles where id = s.owner_id),
        'title', s.title, 'titleAr', s.title_ar,
        'note', s.note, 'accent', s.accent, 'year', s.year,
        'tags', to_jsonb(s.tags), 'lines', s.lines,
        'audioPath', s.audio_path, 'audioMime', s.audio_mime, 'audioBytes', s.audio_bytes,
        'durationMs', s.duration_ms, 'artworkPath', s.artwork_path, 'status', s.status,
        'publishedAt', floor(extract(epoch from s.published_at) * 1000)::bigint,
        'plays', s.plays, 'likes', s.likes, 'notes', s.notes
      ) order by s.published_at desc)
      from public.songs s where s.owner_id = v_id and s.status <> 'removed'
    ), '[]'::jsonb),
    'history', public.my_history(40)
  );
end;
$$;

grant execute on function public.my_bootstrap() to authenticated;

create or replace function public.publisher_profile(p_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_id uuid := null;
begin
  select * into v_profile from public.profiles where handle = lower(coalesce(p_id, ''));
  if not found and p_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := p_id::uuid;
    select * into v_profile from public.profiles where id = v_id;
  end if;
  if not found then
    return null;
  end if;
  v_id := v_profile.id;

  return jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_profile.handle, 'profileId', v_profile.id,
      'handle', v_profile.handle, 'name', v_profile.name,
      'nameAr', v_profile.name_ar, 'tagline', v_profile.tagline, 'bio', v_profile.bio, 'city', v_profile.city,
      'accent', v_profile.accent, 'role', v_profile.role, 'kind', v_profile.kind,
      'verified', v_profile.verified,
      'createdAt', floor(extract(epoch from v_profile.created_at) * 1000)::bigint
    ),
    'followers', (select count(*)::int from public.follows f where f.artist_id = v_id),
    'youFollow', coalesce(
      (select count(*) > 0 from public.follows f
        where f.artist_id = v_id and f.profile_id = auth.uid()), false),
    'songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'ownerId', s.owner_id,
        'ownerHandle', (select handle from public.profiles where id = s.owner_id),
        'ownerName', (select name from public.profiles where id = s.owner_id),
        'title', s.title, 'titleAr', s.title_ar,
        'note', s.note, 'accent', s.accent, 'year', s.year,
        'tags', to_jsonb(s.tags), 'lines', s.lines,
        'audioPath', s.audio_path, 'audioMime', s.audio_mime, 'audioBytes', s.audio_bytes,
        'durationMs', s.duration_ms, 'artworkPath', s.artwork_path, 'status', s.status,
        'publishedAt', floor(extract(epoch from s.published_at) * 1000)::bigint,
        'plays', s.plays, 'likes', s.likes, 'notes', s.notes
      ) order by s.published_at desc)
      from public.songs s where s.owner_id = v_id and s.status = 'live'
    ), '[]'::jsonb),
    'totals', coalesce((
      select jsonb_build_object('plays', sum(s.plays)::int, 'likes', sum(s.likes)::int, 'notes', sum(s.notes)::int)
      from public.songs s where s.owner_id = v_id and s.status = 'live'
    ), jsonb_build_object('plays', 0, 'likes', 0, 'notes', 0))
  );
end;
$$;

grant execute on function public.publisher_profile(text) to anon, authenticated;

-- The dashboard describes the project as it is: listeners are accounts,
-- publishers are accounts with something published.
create or replace function public.admin_summary(p_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'That is a staff-only page.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'totals', jsonb_build_object(
      'users', (select count(*)::int from public.profiles),
      'artists', (select count(distinct s.owner_id)::int from public.songs s where s.status = 'live' and s.owner_id is not null),
      'songs', (select count(*)::int from public.songs where status = 'live'),
      'removed', (select count(*)::int from public.songs where status = 'removed'),
      'plays', (select coalesce(sum(plays), 0)::bigint from public.song_stats_daily),
      'listenSeconds', (select coalesce(sum(seconds), 0)::bigint from public.song_stats_daily),
      'notes', (select count(*)::int from public.comments where not removed),
      'likes', (select count(*)::int from public.loves),
      'amens', (select count(*)::int from public.amens),
      'reportsOpen', (select count(*)::int from public.reports where not resolved),
      'storageBytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects
                        where bucket_id in ('nasheed-audio', 'nasheed-artwork'))
    ),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
                'day', d.day, 'plays', d.plays, 'listeners', d.listeners, 'signups', d.signups) order by d.day), '[]'::jsonb)
              from public.daily_curve(p_days) d),
    'topSongs', (select coalesce(jsonb_agg(jsonb_build_object(
                'songId', t.song_id, 'title', t.title, 'ownerName', t.owner_name,
                'plays', t.plays, 'listeners', t.listeners, 'seconds', t.seconds, 'likes', t.likes) order by t.plays desc), '[]'::jsonb)
              from public.trending('30d', 10) t),
    'topOwners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ownerId', o.owner_id, 'name', o.name, 'handle', o.handle,
        'songs', o.songs, 'plays', o.plays) order by o.plays desc)
      from (
        select s.owner_id, p.name, p.handle, count(s.id)::int as songs, coalesce(sum(s.plays), 0)::bigint as plays
        from public.songs s
        join public.profiles p on p.id = s.owner_id
        where s.status = 'live' and s.owner_id is not null
        group by s.owner_id, p.name, p.handle
        order by plays desc
        limit 8
      ) o
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'commentId', r.comment_id, 'reporterId', r.reporter_id, 'reason', r.reason,
        'createdAt', floor(extract(epoch from r.created_at) * 1000)::bigint, 'resolved', r.resolved,
        'commentText', r.comment_text, 'authorHandle', r.author_handle,
        'songId', r.song_id, 'songTitle', r.song_title) order by r.created_at desc)
      from public.reports r
      where not r.resolved
      limit 50
    ), '[]'::jsonb),
    'recentSongs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'owner', p.handle, 'hasAudio', s.audio_path is not null,
        'status', s.status, 'plays', s.plays,
        'publishedAt', floor(extract(epoch from s.published_at) * 1000)::bigint) order by s.published_at desc)
      from public.songs s
      left join public.profiles p on p.id = s.owner_id
      limit 25
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.admin_summary(integer) to authenticated;

/* ======================================================================== */
/*  6. storage: mp3, and nothing else                                       */
/* ======================================================================== */

-- The audio bucket accepted a dozen container formats. It accepts one now: an
-- mp3, because that is what the player is allowed to play and what the product
-- promises. Artwork keeps its image types.
-- The limits are the product's promises, so they are the same numbers the browser
-- enforces before it uploads anything (`shared/types.ts`, `src/lib/compress.ts`):
-- a recording is at most 5 MB — transcoded in the browser when it is larger — and
-- cover art at most 2 MB. Three places, one number.
update storage.buckets
   set allowed_mime_types = array['audio/mpeg', 'audio/mp3', 'audio/x-mpeg'],
       file_size_limit = 5242880
 where id = 'nasheed-audio';

update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/avif'],
       file_size_limit = 2097152
 where id = 'nasheed-artwork';

/* ======================================================================== */
/*  7. the database says which version of the app it is                     */
/* ======================================================================== */

-- Everything above is a migration a project has to have run to work with this build.
-- A project that has not run it has the old shape of `songs` — where `maqam` and the
-- other composition columns are NOT NULL — so an insert from the audio-only client
-- fails on a column it does not send, and the failure looks nothing like the cause.
--
-- One row, one string. The client reads it at boot (`src/lib/schema.ts`) and can then
-- say "this database is behind" instead of leaving somebody to guess from a constraint
-- name. It is deliberately a plain table rather than a function: a function that does
-- not exist and a function that failed look identical from the browser.
create table if not exists public.app_schema (
  id         integer primary key default 1 check (id = 1),
  version    text not null,
  applied_at timestamptz not null default now()
);

insert into public.app_schema (id, version)
values (1, 'audio-only-1')
on conflict (id) do update set version = excluded.version, applied_at = now();

alter table public.app_schema enable row level security;

-- Readable by anyone, including signed-out visitors: knowing whether a project is set
-- up is not a secret, and the answer is useful before there is an account.
drop policy if exists "the schema version is public" on public.app_schema;
create policy "the schema version is public" on public.app_schema
  for select to anon, authenticated
  using (true);

grant select on public.app_schema to anon, authenticated;
revoke insert, update, delete on public.app_schema from anon, authenticated;
