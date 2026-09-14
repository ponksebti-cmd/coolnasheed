-- CoolNasheed · reads and writes that belong in the database
--
-- These are Postgres functions called through PostgREST (`supabase.rpc(...)`). They do
-- the work a traditional backend would do — validate a play, roll it up, build a chart,
-- assemble a boot payload — but they cost no Edge Function invocation, have no cold
-- start, and run in one transaction against the data they read.
--
-- The division of labour, stated plainly:
--   Postgres functions  → anything that is a query with rules around it (all of the below)
--   Edge Functions      → anything that needs a secret, a network call, caching in front
--                         of the database, or multipart handling (supabase/functions)

/* -------------------------------------------------------------- play beacon */

-- The single write path for a listen. Validates, inserts the event, rolls it up per
-- song per day, rolls the site up per day, and bumps the song's counter only when the
-- listen was real: fifteen seconds or a completion. A skip should not flatter a track.
create or replace function public.record_play(
  p_song_id text,
  p_seconds integer default 0,
  p_completed boolean default false,
  p_client_id text default null
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
  v_client text;
  v_key text;
  v_new_listener boolean := false;
  v_counted boolean;
begin
  select * into v_song from public.songs where id = p_song_id and status = 'live';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That nasheed is not here.');
  end if;

  v_seconds := least(greatest(coalesce(p_seconds, 0), 0), 21600);
  v_counted := coalesce(p_completed, false) or v_seconds >= 15;
  v_client := nullif(left(coalesce(p_client_id, ''), 64), '');
  v_key := coalesce('u:' || v_profile::text, 'c:' || v_client, 'anon');

  -- a beacon storm should not turn into a chart: one listen per song per five seconds
  if exists (
    select 1 from public.play_events
    where song_id = v_song.id
      and created_at > now() - interval '5 seconds'
      and ((v_profile is not null and profile_id = v_profile) or (v_profile is null and client_id is not distinct from v_client))
  ) then
    return jsonb_build_object('ok', true, 'counted', false, 'duplicate', true, 'plays', v_song.plays);
  end if;

  -- is this listener new to this song today? that is what "listeners" means
  select not exists (
    select 1 from public.play_events
    where song_id = v_song.id and day = v_day
      and coalesce('u:' || profile_id::text, 'c:' || client_id, 'anon') = v_key
  ) into v_new_listener;

  insert into public.play_events (song_id, profile_id, client_id, seconds, completed, day)
  values (v_song.id, v_profile, v_client, v_seconds, coalesce(p_completed, false), v_day);

  insert into public.song_stats_daily (song_id, day, plays, listeners, seconds)
  values (v_song.id, v_day, 1, case when v_new_listener then 1 else 0 end, v_seconds)
  on conflict (song_id, day) do update
    set plays = public.song_stats_daily.plays + 1,
        listeners = public.song_stats_daily.listeners + case when v_new_listener then 1 else 0 end,
        seconds = public.song_stats_daily.seconds + v_seconds;

  insert into public.site_stats_daily (day, plays, listeners)
  values (v_day, 1, case when v_new_listener then 1 else 0 end)
  on conflict (day) do update
    set plays = public.site_stats_daily.plays + 1,
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

grant execute on function public.record_play(text, integer, boolean, text) to anon, authenticated;

/* ------------------------------------------------------------------- charts */

create or replace function public.trending(p_window text default '7d', p_limit integer default 10)
returns table (
  song_id text,
  title text,
  accent text,
  maqam text,
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
  select s.id, s.title, s.accent, s.maqam, p.name,
         sum(d.plays)::bigint, sum(d.listeners)::bigint, sum(d.seconds)::bigint, s.likes
  from public.song_stats_daily d
  join public.songs s on s.id = d.song_id and s.status = 'live'
  left join public.profiles p on p.id = s.owner_id
  cross join bounds b
  where d.day >= b.since
  group by s.id, s.title, s.accent, s.maqam, p.name, s.likes
  order by sum(d.plays) desc, s.likes desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

grant execute on function public.trending(text, integer) to anon, authenticated;

create or replace function public.daily_curve(p_days integer default 14)
returns table (day date, plays integer, listeners integer, signups integer)
language sql
stable
security definer
set search_path = public
as $$
  select d.day::date,
         coalesce(s.plays, 0),
         coalesce(s.listeners, 0),
         coalesce(s.signups, 0)
  from generate_series(
         (now() at time zone 'utc')::date - (least(greatest(coalesce(p_days, 14), 1), 90) - 1),
         (now() at time zone 'utc')::date,
         interval '1 day'
       ) as d(day)
  left join public.site_stats_daily s on s.day = d.day::date
  order by d.day;
$$;

grant execute on function public.daily_curve(integer) to anon, authenticated;

create or replace function public.song_stats(p_song_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'plays', coalesce((select plays from public.songs where id = p_song_id), 0),
    'listeners', coalesce((select sum(listeners) from public.song_stats_daily where song_id = p_song_id), 0),
    'seconds', coalesce((select sum(seconds) from public.song_stats_daily where song_id = p_song_id), 0),
    'completed', coalesce((select count(*) from public.play_events where song_id = p_song_id and completed), 0),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'plays', d.plays, 'listeners', d.listeners) order by d.day)
      from public.song_stats_daily d
      where d.song_id = p_song_id and d.day >= (now() at time zone 'utc')::date - 29
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.song_stats(text) to anon, authenticated;

-- A signed-in listener reads their own history. A signed-out one reads the history of a
-- device id it supplies, which is what makes "recently played" work before you have an
-- account. The id is a random 24-hex string held in localStorage, not a credential: it
-- protects nothing, and the worst it exposes is which nasheeds one anonymous device
-- played. That trade is deliberate, and it is written down here so nobody mistakes it
-- for an oversight.
create or replace function public.my_history(p_limit integer default 30, p_client_id text default null)
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
  if v_profile is null and nullif(p_client_id, '') is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t."lastAt" desc)
    from (
      select e.song_id as "songId",
             s.title as "title",
             s.accent as "accent",
             p.name as "ownerName",
             count(*)::int as "plays",
             sum(e.seconds)::int as "seconds",
             floor(extract(epoch from max(e.created_at)) * 1000)::bigint as "lastAt"
      from public.play_events e
      join public.songs s on s.id = e.song_id and s.status = 'live'
      left join public.profiles p on p.id = s.owner_id
      where (v_profile is not null and e.profile_id = v_profile)
         or (v_profile is null and e.client_id = nullif(p_client_id, ''))
      group by e.song_id, s.title, s.accent, p.name
      order by 7 desc
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.my_history(integer, text) to anon, authenticated;

/* ------------------------------------------------------- listening totals */

create or replace function public.my_listening()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'plays', count(*)::int,
    'listenSeconds', coalesce(sum(seconds), 0)::bigint,
    'days', count(distinct day)::int,
    'songs', count(distinct song_id)::int,
    'firstAt', case when min(created_at) is null then null
                    else floor(extract(epoch from min(created_at)) * 1000)::bigint end
  )
  from public.play_events
  where profile_id = auth.uid();
$$;

grant execute on function public.my_listening() to authenticated;

/* ------------------------------------------------------------- boot payloads */

-- One call, everything a cold start needs to draw the home page. The Edge Function
-- `catalog` wraps this with a 60-second cache so a thousand visitors cost one query.
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
        -- the handle is the public id, so a publisher page reads /yusuf rather than /9f3c…
        'id', p.handle,
        'profileId', p.id,
        'handle', p.handle,
        'name', p.name,
        'nameAr', p.name_ar,
        'role', coalesce(nullif(p.tagline, ''), 'Publisher'),
        'origin', coalesce(nullif(p.city, ''), '—'),
        'bio', p.bio,
        'seed', p.seed,
        'accent', p.accent,
        'verified', p.verified,
        'kind', p.kind,
        'songs', (select count(*)::int from public.songs s where s.owner_id = p.id and s.status = 'live'),
        'followers', (select count(*)::int from public.follows f where f.artist_id = p.id)
      ) order by p.name)
      from public.profiles p
      -- anybody with a live nasheed is a publisher, whether they arrived in the seed
      -- (kind = 'artist') or signed up and used the studio (kind = 'listener')
      where exists (select 1 from public.songs s where s.owner_id = p.id and s.status = 'live')
    ), '[]'::jsonb),
    'songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'ownerId', s.owner_id,
        'ownerHandle', (select handle from public.profiles where id = s.owner_id),
        'title', s.title,
        'titleAr', s.title_ar,
        'note', s.note,
        'maqam', s.maqam,
        'root', s.root,
        'bpm', s.bpm,
        'voices', s.voices,
        'duff', s.duff,
        'duffEnter', s.duff_enter,
        'passes', s.passes,
        'accent', s.accent,
        'year', s.year,
        'tags', to_jsonb(s.tags),
        'lines', s.lines,
        'motifBank', to_jsonb(s.motif_bank),
        'audioPath', s.audio_path,
        'audioMime', s.audio_mime,
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
        'seed', c.seed,
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
    'generatedAt', floor(extract(epoch from now()) * 1000)::bigint,
    'seeded', exists (select 1 from public.profiles where kind = 'artist' and verified)
  );
$$;

grant execute on function public.catalog_payload() to anon, authenticated;

-- Everything about *you* in one call: profile, counters, loves, follows, sets, what you
-- published and what you have been playing. The client would otherwise fire eight.
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
begin
  if v_id is null then
    return jsonb_build_object('user', null);
  end if;

  select * into v_profile from public.profiles where id = v_id;
  if not found then
    return jsonb_build_object('user', null);
  end if;

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
      'seed', v_profile.seed,
      'accent', v_profile.accent,
      'role', v_profile.role,
      'kind', v_profile.kind,
      'verified', v_profile.verified,
      'createdAt', floor(extract(epoch from v_profile.created_at) * 1000)::bigint
    ),
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
        'seed', p.seed, 'accent', p.accent, 'songIds', to_jsonb(p.song_ids),
        'createdAt', floor(extract(epoch from p.created_at) * 1000)::bigint
      ) order by p.created_at desc)
      from public.playlists p where p.owner_id = v_id
    ), '[]'::jsonb),
    'songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'ownerId', s.owner_id,
        'ownerHandle', (select handle from public.profiles where id = s.owner_id),
        'title', s.title, 'titleAr', s.title_ar,
        'note', s.note, 'maqam', s.maqam, 'root', s.root, 'bpm', s.bpm, 'voices', s.voices,
        'duff', s.duff, 'duffEnter', s.duff_enter, 'passes', s.passes, 'accent', s.accent,
        'year', s.year, 'tags', to_jsonb(s.tags), 'lines', s.lines, 'motifBank', to_jsonb(s.motif_bank),
        'audioPath', s.audio_path, 'audioMime', s.audio_mime, 'durationMs', s.duration_ms,
        'artworkPath', s.artwork_path, 'status', s.status,
        'publishedAt', floor(extract(epoch from s.published_at) * 1000)::bigint,
        'plays', s.plays, 'likes', s.likes, 'notes', s.notes
      ) order by s.published_at desc)
      from public.songs s where s.owner_id = v_id and s.status <> 'removed'
    ), '[]'::jsonb),
    'history', public.my_history(40, null)
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
  -- publishers are addressed by handle (/yusuf); a bare uuid still works
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
      'seed', v_profile.seed, 'accent', v_profile.accent, 'role', v_profile.role,
      'kind', v_profile.kind, 'verified', v_profile.verified,
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
        'title', s.title, 'titleAr', s.title_ar,
        'note', s.note, 'maqam', s.maqam, 'root', s.root, 'bpm', s.bpm, 'voices', s.voices,
        'duff', s.duff, 'duffEnter', s.duff_enter, 'passes', s.passes, 'accent', s.accent,
        'year', s.year, 'tags', to_jsonb(s.tags), 'lines', s.lines, 'motifBank', to_jsonb(s.motif_bank),
        'audioPath', s.audio_path, 'audioMime', s.audio_mime, 'durationMs', s.duration_ms,
        'artworkPath', s.artwork_path, 'status', s.status,
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

/* --------------------------------------------------------------- moderation */

create or replace function public.report_comment(p_comment_id text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comment public.comments;
  v_song public.songs;
  v_id uuid := auth.uid();
begin
  if v_id is null then
    raise exception 'You need an account to report a note.' using errcode = '42501';
  end if;
  if char_length(coalesce(p_reason, '')) not between 3 and 300 then
    raise exception 'A reason between 3 and 300 characters, please.' using errcode = '22023';
  end if;

  select * into v_comment from public.comments where id = p_comment_id and not removed;
  if not found then
    raise exception 'That note is gone.' using errcode = 'P0002';
  end if;
  select * into v_song from public.songs where id = v_comment.song_id;

  insert into public.reports (comment_id, reporter_id, reason, comment_text, author_handle, song_id, song_title)
  values (
    v_comment.id, v_id, p_reason, left(v_comment.text, 600),
    coalesce((select handle from public.profiles where id = v_comment.author_id), ''),
    coalesce(v_song.id, ''), coalesce(v_song.title, '')
  );

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.report_comment(text, text) to authenticated;

-- Resolve a report, optionally hiding the note it was about. Staff only.
create or replace function public.resolve_report(p_report_id text, p_hide boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports;
begin
  if not public.is_staff() then
    raise exception 'That is a staff-only action.' using errcode = '42501';
  end if;

  select * into v_report from public.reports where id = p_report_id;
  if not found then
    raise exception 'No such report.' using errcode = 'P0002';
  end if;

  update public.reports set resolved = true, resolved_at = now() where id = p_report_id;

  -- Staff have two answers: "this note goes" and "this note stands". Three reports
  -- hide a note on their own, so closing a report as unfounded has to be able to put
  -- the note back — otherwise something the trigger hid stays hidden and the way back
  -- is a second action nobody would think to take. The words stay in the row either
  -- way; `removed` is what decides whether the room can see it.
  update public.comments
     set removed = p_hide
   where id = v_report.comment_id
     and removed is distinct from p_hide;

  return jsonb_build_object('ok', true, 'hid', p_hide);
end;
$$;

grant execute on function public.resolve_report(text, boolean) to authenticated;

/* ------------------------------------------------------------------ dashboard */

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
      'users', (select count(*)::int from public.profiles where kind = 'listener'),
      'artists', (select count(*)::int from public.profiles where kind = 'artist'),
      'songs', (select count(*)::int from public.songs where status = 'live'),
      'removed', (select count(*)::int from public.songs where status = 'removed'),
      'plays', (select coalesce(sum(plays), 0)::bigint from public.song_stats_daily),
      'listenSeconds', (select coalesce(sum(seconds), 0)::bigint from public.song_stats_daily),
      'notes', (select count(*)::int from public.comments where not removed),
      'likes', (select count(*)::int from public.loves),
      'amens', (select count(*)::int from public.amens),
      'reportsOpen', (select count(*)::int from public.reports where not resolved),
      'storageBytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects
                        where bucket_id in ('nasheed-audio','nasheed-artwork'))
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

/* ------------------------------------------------------------------ retention */

-- The rollups are the history; the raw events are only needed for recent detail. Keeping
-- 90 days of them is what keeps a free-tier database under its 500 MB ceiling forever.
create or replace function public.prune_play_events(p_keep_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  delete from public.play_events
  where day < (now() at time zone 'utc')::date - least(greatest(coalesce(p_keep_days, 90), 7), 365);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- only the service role (or a scheduled job) may prune
revoke execute on function public.prune_play_events(integer) from public;
grant execute on function public.prune_play_events(integer) to service_role;

-- pg_cron is available on the free tier; if it is not enabled on your project this
-- block fails quietly and you can run `select public.prune_play_events()` by hand.
do $body$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule(
    'coolnasheed-prune-play-events',
    '17 3 * * *',
    'select public.prune_play_events(90)'
  );
exception when others then
  raise notice 'pg_cron unavailable (%), skipping the retention schedule', sqlerrm;
end;
$body$;
