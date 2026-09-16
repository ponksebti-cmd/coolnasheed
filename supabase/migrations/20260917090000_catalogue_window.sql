-- ---------------------------------------------------------------------------
--  CoolNasheed · migration 8: the catalogue is a window, not the whole world
--
--  `catalog_payload()` used to hand the browser every live nasheed in the database,
--  with every line of every lyric, in one answer at boot. That is fine for thirty
--  nasheeds and wrong for three thousand: the first paint waits on a payload that
--  grows forever, and the phone holds all of it in memory to show twelve rows.
--
--  From here it ships a window — the newest 300 nasheeds and the 200 publishers with
--  the most of them. The window is what the home page, the rails and the tag cloud
--  need; anything that reaches past it asks for exactly what it needs:
--
--    • searching        the search screen queries `songs?q=`, which reads the whole
--                       table through the trigram index and pages 60 at a time
--    • a loved nasheed  `ensureSongs(ids)` fetches the ids the window left out
--    • a reciter's page `ensureArtistSongs(handle)` fetches their back catalogue
--
--  Nothing is hidden: the same rows are public, and every list that can be longer than
--  the window knows how to ask for the rest. The tag cloud still counts *all* live
--  nasheeds, because a count is cheap and a wrong count is not.
--
--  Written to run once, in order, after migration 7. Every statement is guarded, and
--  this file is wrapped by the bundle's ledger, so re-running it is a no-op.
-- ---------------------------------------------------------------------------

/* ======================================================================== */
/*  the payload, bounded                                                    */
/* ======================================================================== */

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
        'id', a.handle,
        'profileId', a.id,
        'handle', a.handle,
        'name', a.name,
        'nameAr', a.name_ar,
        'role', coalesce(nullif(a.tagline, ''), 'Publisher'),
        'origin', coalesce(nullif(a.city, ''), '—'),
        'bio', a.bio,
        'accent', a.accent,
        'verified', a.verified,
        'avatarPath', a.avatar_path,
        'kind', a.kind,
        'songs', a.live_songs,
        'followers', (select count(*)::int from public.follows f where f.artist_id = a.id)
      ) order by a.name)
      from (
        select p.*,
               (select count(*)::int from public.songs s
                 where s.owner_id = p.id and s.status = 'live') as live_songs
        from public.profiles p
        where exists (
          select 1 from public.songs s where s.owner_id = p.id and s.status = 'live'
        )
        order by live_songs desc, p.name
        limit 200
      ) a
    ), '[]'::jsonb),
    'songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id,
        'ownerId', w.owner_id,
        'ownerHandle', w.owner_handle,
        'ownerName', w.owner_name,
        'title', w.title,
        'titleAr', w.title_ar,
        'note', w.note,
        'tags', to_jsonb(w.tags),
        'lines', w.lines,
        'audioPath', w.audio_path,
        'audioMime', w.audio_mime,
        'audioBytes', w.audio_bytes,
        'durationMs', w.duration_ms,
        'artworkPath', w.artwork_path,
        'status', w.status,
        'publishedAt', floor(extract(epoch from w.published_at) * 1000)::bigint,
        'plays', w.plays,
        'likes', w.likes,
        'notes', w.notes
      ) order by w.published_at desc)
      from (
        select s.*,
               (select handle from public.profiles where id = s.owner_id) as owner_handle,
               (select name from public.profiles where id = s.owner_id) as owner_name
        from public.songs s
        where s.status = 'live'
        order by s.published_at desc
        limit 300
      ) w
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
      from (
        select unnest(tags) as tag, count(*)::int
        from public.songs
        where status = 'live'
        group by 1
      ) t
    ), '[]'::jsonb),
    'generatedAt', floor(extract(epoch from now()) * 1000)::bigint
  );
$$;

grant execute on function public.catalog_payload() to anon, authenticated;

/* ======================================================================== */
/*  the account rows that were never asked                                   */
/* ======================================================================== */

-- The story of the default theme in three lines:
--
--   migration 5   user_prefs.theme defaulted to 'night'
--   migration 7   the default became 'dawn'
--   migration 8   the rows written under the old default are put right
--
-- The problem is that a column default is indistinguishable from a choice: the old
-- client saved the whole settings row on any change — a volume nudge was enough — so an
-- account could end up holding 'night' without anybody ever having asked for the dark
-- book. Every device that had never chosen then inherited it, wrote it down, and the
-- house default of light was never seen. (`20260916095000_profile_pictures.sql` changed
-- the default; it could not know which rows were decisions.)
--
-- So: a marker for the decisions, and the unmarked rows go to the house default once.
-- Picking a theme now writes the marker (the client sends `theme_chosen_at`), so a night
-- listener who chooses night again keeps it for good — on the account and on the device.
alter table public.user_prefs add column if not exists theme_chosen_at timestamptz;

update public.user_prefs
   set theme = 'dawn'
 where theme = 'night'
   and theme_chosen_at is null;

/* ======================================================================== */
/*  and the database says so                                                */
/* ======================================================================== */

update public.app_schema
   set version = 'catalogue-window-1', applied_at = now()
 where id = 1;
