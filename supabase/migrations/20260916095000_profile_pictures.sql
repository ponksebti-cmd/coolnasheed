-- ---------------------------------------------------------------------------
--  CoolNasheed · migration 7: a person may have a picture
--
--  Migration 1 gave every account a handle, a name and a bio. What it never gave
--  anybody was a face: the circle beside a name has always been initials on an accent
--  tint. This adds the picture, and nothing else — one nullable column, one public
--  bucket capped at 1 MB, and the same three storage policies recordings and covers
--  already have (read: anyone; write: your own folder only).
--
--  The row stores a *path*, never a URL, exactly as `songs.audio_path` does: nothing in
--  this database knows the project's hostname, so a project can move without a rewrite.
--
--  Written to run once, in order, after migration 6. Every statement is guarded, and
--  this file is wrapped by the bundle's ledger, so re-running it is a no-op.
-- ---------------------------------------------------------------------------

/* ======================================================================== */
/*  the column                                                              */
/* ======================================================================== */

alter table public.profiles add column if not exists avatar_path text;

-- `<uid>/avatar-<stamp>-<nonce>.<ext>`, and it may simply be absent. The shape is
-- deliberately loose — the bucket policies are what keep a path inside its own folder —
-- but a picture path longer than a path can be is a bug, and this says so.
do $cn_avatar$
begin
  if not exists (select 1 from pg_constraint where conname = 'avatar_path_shape') then
    alter table public.profiles
      add constraint avatar_path_shape
      check (avatar_path is null or char_length(avatar_path) between 3 and 200);
  end if;
end
$cn_avatar$;

comment on column public.profiles.avatar_path is
  'storage path of the profile picture, `<uid>/avatar-…`; null when there is none';

/* The light book is the house default, and the database should say the same thing the app
   says. A settings row that nobody has written yet used to be born dark, which made dawn
   look like something a person had switched away from. Rows that already say `night` are
   left exactly as they are: that may be somebody's own choice, and this migration has no
   way to tell — the app trusts the row. */
alter table public.user_prefs alter column theme set default 'dawn';

/* ======================================================================== */
/*  the bucket                                                              */
/* ======================================================================== */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('nasheed-avatars', 'nasheed-avatars', true, 1048576, array[
    'image/png', 'image/jpeg', 'image/webp', 'image/avif'
  ])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------ read ---------------------------------------

drop policy if exists "profile pictures are public" on storage.objects;
create policy "profile pictures are public"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'nasheed-avatars');

-- ------------------------------ write --------------------------------------
-- every picture lives under the uploader's own uid folder

drop policy if exists "a listener uploads into their own picture folder" on storage.objects;
create policy "a listener uploads into their own picture folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'nasheed-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "a listener may replace their own picture" on storage.objects;
create policy "a listener may replace their own picture"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'nasheed-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'nasheed-avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "a listener may delete their own picture" on storage.objects;
create policy "a listener may delete their own picture"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'nasheed-avatars'
    and (split_part(name, '/', 1) = auth.uid()::text or public.is_staff())
  );

/* ======================================================================== */
/*  the payloads that carry a person                                        */
/* ======================================================================== */

-- Whoever is looking at the app has a face of their own; every payload that describes a
-- person now carries it. Replaced in place, exactly as migration 6 left them, plus one
-- key each.

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
      'avatarPath', v_profile.avatar_path,
      'createdAt', floor(extract(epoch from v_profile.created_at) * 1000)::bigint
    ),
    'prefs', jsonb_build_object(
      'theme', coalesce(v_prefs.theme, 'dawn'),
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
      'avatarPath', v_profile.avatar_path,
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
        'avatarPath', p.avatar_path,
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

/* ======================================================================== */
/*  and the staff dashboard counts the new bucket                           */
/* ======================================================================== */

-- One number changes: storageBytes now includes profile pictures, because they are
-- stored bytes like everything else.

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
                        where bucket_id in ('nasheed-audio', 'nasheed-artwork', 'nasheed-avatars'))
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
/*  and the database says so                                                */
/* ======================================================================== */

update public.app_schema
   set version = 'profile-pictures-1', applied_at = now()
 where id = 1;
