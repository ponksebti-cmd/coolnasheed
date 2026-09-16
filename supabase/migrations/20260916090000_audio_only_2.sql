-- ---------------------------------------------------------------------------
--  CoolNasheed · migration 6: a nasheed is a recording, a title and the words
--
--  Migration 5 removed the composition model — maqam, tempo, voices, drum pattern.
--  Two fields survived it that nobody should have to think about:
--
--    accent   a colour picker. It chose the tint of the placeholder tile a nasheed
--             gets when the publisher has not uploaded cover art. A publisher
--             choosing a hue is a decision that does not exist in the product.
--    year     a four-digit field with a 1300–2200 range. A nasheed is a recording;
--             when it was recorded is not something the catalogue asks or shows.
--
--  Both go, with the five payload functions that carried them. The tile uses the
--  house accent, which is what the app looks like without anybody configuring it.
--
--  Written to run once, in order, after migration 5. Every statement is guarded, and
--  this file is wrapped by the bundle's ledger, so re-running it is a no-op.
-- ---------------------------------------------------------------------------

/* ======================================================================== */
/*  the two columns, and the payload functions that named them              */
/* ======================================================================== */

-- The chart row no longer carries a colour.
-- `create or replace` cannot change a function's OUT row, so it is dropped first.
drop function if exists public.trending(text, integer);

create or replace function public.trending(p_window text default '7d', p_limit integer default 10)
returns table (
  song_id text,
  title text,
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
  select s.id, s.title, s.artwork_path, p.name,
         sum(d.plays)::bigint, sum(d.listeners)::bigint, sum(d.seconds)::bigint, s.likes
  from public.song_stats_daily d
  join public.songs s on s.id = d.song_id and s.status = 'live'
  left join public.profiles p on p.id = s.owner_id
  cross join bounds b
  where d.day >= b.since
  group by s.id, s.title, s.artwork_path, p.name, s.likes
  order by sum(d.plays) desc, s.likes desc
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

grant execute on function public.trending(text, integer) to anon, authenticated;

-- Recently played: the same rows, one key lighter.

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
             s.artwork_path as "artworkPath",
             p.name as "ownerName",
             count(*)::int as "plays",
             sum(e.seconds)::int as "seconds",
             floor(extract(epoch from max(e.created_at)) * 1000)::bigint as "lastAt"
      from public.play_events e
      join public.songs s on s.id = e.song_id and s.status = 'live'
      left join public.profiles p on p.id = s.owner_id
      where e.profile_id = v_profile
      group by e.song_id, s.title, s.artwork_path, p.name
      order by "lastAt" desc
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.my_history(integer) to authenticated;

-- The whole catalogue in one call: songs without a colour or a year.

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

-- Everything a cold start needs.

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
        'note', s.note,
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

-- A publisher's page.

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
        'note', s.note,
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

/* ======================================================================== */
/*  the two columns                                                         */
/* ======================================================================== */

-- Last, after the functions that named them have been replaced. Dropping a column takes
-- its CHECK constraint, its column grant and its index with it; there is nothing left to
-- tidy.
alter table public.songs
  drop column if exists accent,
  drop column if exists year;

/* ======================================================================== */
/*  and the database says so                                                */
/* ======================================================================== */

update public.app_schema
   set version = 'audio-only-2', applied_at = now()
 where id = 1;
