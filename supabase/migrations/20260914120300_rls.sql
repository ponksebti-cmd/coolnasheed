-- ---------------------------------------------------------------------------
--  Cool Nasheed · migration 3: row level security
--
--  The rule of the house:
--    · anyone, account or not, can read what is published and count it;
--    · a listener writes only rows that belong to them;
--    · a publisher manages what they published;
--    · staff manage everything;
--    · nobody edits a counter, a role or a verified flag by hand — those move
--      through the triggers and stored procedures in the migrations before this.
-- ---------------------------------------------------------------------------

alter table public.profiles           enable row level security;
alter table public.songs              enable row level security;
alter table public.collections        enable row level security;
alter table public.comments           enable row level security;
alter table public.loves              enable row level security;
alter table public.amens              enable row level security;
alter table public.follows            enable row level security;
alter table public.playlists          enable row level security;
alter table public.saved_collections  enable row level security;
alter table public.reports            enable row level security;
alter table public.play_events        enable row level security;
alter table public.song_stats_daily   enable row level security;
alter table public.site_stats_daily   enable row level security;
alter table public.reserved_handles   enable row level security;

-- ------------------------------- profiles ----------------------------------
-- readable by everyone: a publisher page is a public page.
-- writable by nobody at insert time — the auth.users trigger makes the row.

drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public"
  on public.profiles for select to anon, authenticated
  using (true);

drop policy if exists "you may edit your own profile" on public.profiles;
create policy "you may edit your own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "staff may remove a profile" on public.profiles;
create policy "staff may remove a profile"
  on public.profiles for delete to authenticated
  using (id = auth.uid() or public.is_staff());

-- -------------------------------- songs ------------------------------------

drop policy if exists "live nasheeds are public" on public.songs;
create policy "live nasheeds are public"
  on public.songs for select to anon, authenticated
  using (
    status = 'live'
    or owner_id = auth.uid()
    or public.is_staff()
  );

drop policy if exists "a publisher may add their own nasheed" on public.songs;
create policy "a publisher may add their own nasheed"
  on public.songs for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "a publisher may edit their own nasheed" on public.songs;
create policy "a publisher may edit their own nasheed"
  on public.songs for update to authenticated
  using (owner_id = auth.uid() or public.is_staff())
  with check (owner_id = auth.uid() or public.is_staff());

drop policy if exists "a publisher may remove their own nasheed" on public.songs;
create policy "a publisher may remove their own nasheed"
  on public.songs for delete to authenticated
  using (owner_id = auth.uid() or public.is_staff());

-- ------------------------------ collections --------------------------------
-- shelves are curated, so they are simply public; only their owner or staff write

drop policy if exists "collections are public" on public.collections;
create policy "collections are public"
  on public.collections for select to anon, authenticated
  using (true);

drop policy if exists "a curator may add a collection" on public.collections;
create policy "a curator may add a collection"
  on public.collections for insert to authenticated
  with check (owner_id = auth.uid() or public.is_staff());

drop policy if exists "a curator may edit their collection" on public.collections;
create policy "a curator may edit their collection"
  on public.collections for update to authenticated
  using (owner_id = auth.uid() or public.is_staff())
  with check (owner_id = auth.uid() or public.is_staff());

drop policy if exists "a curator may remove their collection" on public.collections;
create policy "a curator may remove their collection"
  on public.collections for delete to authenticated
  using (owner_id = auth.uid() or public.is_staff());

-- ------------------------------- comments ----------------------------------
-- a note under your own nasheed is yours to look after, which is why its publisher
-- can see and remove it even when it is hidden from the room

drop policy if exists "notes are public unless removed" on public.comments;
create policy "notes are public unless removed"
  on public.comments for select to anon, authenticated
  using (
    removed = false
    or author_id = auth.uid()
    or public.is_staff()
    or exists (
      select 1 from public.songs s
      where s.id = comments.song_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists "a listener may leave a note" on public.comments;
create policy "a listener may leave a note"
  on public.comments for insert to authenticated
  with check (author_id = auth.uid());

drop policy if exists "a listener may edit their own note" on public.comments;
create policy "a listener may edit their own note"
  on public.comments for update to authenticated
  using (
    author_id = auth.uid()
    or public.is_staff()
    or exists (
      select 1 from public.songs s
      where s.id = comments.song_id and s.owner_id = auth.uid()
    )
  )
  with check (
    author_id = auth.uid()
    or public.is_staff()
    or exists (
      select 1 from public.songs s
      where s.id = comments.song_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists "a listener may delete their own note" on public.comments;
create policy "a listener may delete their own note"
  on public.comments for delete to authenticated
  using (
    author_id = auth.uid()
    or public.is_staff()
    or exists (
      select 1 from public.songs s
      where s.id = comments.song_id and s.owner_id = auth.uid()
    )
  );

-- -------------------------------- loves ------------------------------------
-- what you loved is yours; the room only ever sees the count

drop policy if exists "loves are yours" on public.loves;
create policy "loves are yours"
  on public.loves for select to authenticated
  using (profile_id = auth.uid() or public.is_staff());

drop policy if exists "a listener may love a nasheed" on public.loves;
create policy "a listener may love a nasheed"
  on public.loves for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "a listener may take their love back" on public.loves;
create policy "a listener may take their love back"
  on public.loves for delete to authenticated
  using (profile_id = auth.uid() or public.is_staff());

-- -------------------------------- amens ------------------------------------
-- saying amin to somebody's duʿā is a public act, so the row is public too

drop policy if exists "amens are public encouragement" on public.amens;
create policy "amens are public encouragement"
  on public.amens for select to anon, authenticated
  using (true);

drop policy if exists "a listener may say amin" on public.amens;
create policy "a listener may say amin"
  on public.amens for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "a listener may take their amin back" on public.amens;
create policy "a listener may take their amin back"
  on public.amens for delete to authenticated
  using (profile_id = auth.uid() or public.is_staff());

-- ------------------------------- follows -----------------------------------

drop policy if exists "follows are public" on public.follows;
create policy "follows are public"
  on public.follows for select to anon, authenticated
  using (true);

drop policy if exists "a listener may follow a publisher" on public.follows;
create policy "a listener may follow a publisher"
  on public.follows for insert to authenticated
  with check (profile_id = auth.uid() and profile_id <> artist_id);

drop policy if exists "a listener may unfollow" on public.follows;
create policy "a listener may unfollow"
  on public.follows for delete to authenticated
  using (profile_id = auth.uid() or public.is_staff());

-- ------------------------------- playlists ---------------------------------

drop policy if exists "playlists are yours" on public.playlists;
create policy "playlists are yours"
  on public.playlists for select to authenticated
  using (owner_id = auth.uid() or public.is_staff());

drop policy if exists "a listener may build a playlist" on public.playlists;
create policy "a listener may build a playlist"
  on public.playlists for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "a listener may edit their playlist" on public.playlists;
create policy "a listener may edit their playlist"
  on public.playlists for update to authenticated
  using (owner_id = auth.uid() or public.is_staff())
  with check (owner_id = auth.uid() or public.is_staff());

drop policy if exists "a listener may remove their playlist" on public.playlists;
create policy "a listener may remove their playlist"
  on public.playlists for delete to authenticated
  using (owner_id = auth.uid() or public.is_staff());

-- --------------------------- saved collections -----------------------------

drop policy if exists "saved collections are yours" on public.saved_collections;
create policy "saved collections are yours"
  on public.saved_collections for select to authenticated
  using (profile_id = auth.uid() or public.is_staff());

drop policy if exists "a listener may save a collection" on public.saved_collections;
create policy "a listener may save a collection"
  on public.saved_collections for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "a listener may unsave a collection" on public.saved_collections;
create policy "a listener may unsave a collection"
  on public.saved_collections for delete to authenticated
  using (profile_id = auth.uid() or public.is_staff());

-- -------------------------------- reports ----------------------------------

drop policy if exists "a report is between its author and staff" on public.reports;
create policy "a report is between its author and staff"
  on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_staff());

drop policy if exists "a listener may report a note they did not write" on public.reports;
create policy "a listener may report a note they did not write"
  on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and not exists (
      select 1 from public.comments c
      where c.id = comment_id and c.author_id = auth.uid()
    )
  );

drop policy if exists "staff resolve reports" on public.reports;
create policy "staff resolve reports"
  on public.reports for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "staff may clear reports" on public.reports;
create policy "staff may clear reports"
  on public.reports for delete to authenticated
  using (public.is_staff());

-- ------------------------------ play events --------------------------------
-- anonymous beacons arrive through record_play(), which is security definer and so
-- writes past RLS; a signed-in listener may also write their own row directly.

drop policy if exists "you see your own listening" on public.play_events;
create policy "you see your own listening"
  on public.play_events for select to authenticated
  using (profile_id = auth.uid() or public.is_staff());

drop policy if exists "a listener may record their own play" on public.play_events;
create policy "a listener may record their own play"
  on public.play_events for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "staff may clear play events" on public.play_events;
create policy "staff may clear play events"
  on public.play_events for delete to authenticated
  using (public.is_staff());

-- --------------------------------- rollups ---------------------------------
-- the charts are public information; only stored procedures write them

drop policy if exists "daily nasheed stats are public" on public.song_stats_daily;
create policy "daily nasheed stats are public"
  on public.song_stats_daily for select to anon, authenticated
  using (true);

drop policy if exists "daily site stats are public" on public.site_stats_daily;
create policy "daily site stats are public"
  on public.site_stats_daily for select to anon, authenticated
  using (true);

-- --------------------------- reserved handles ------------------------------

drop policy if exists "staff manage reserved handles" on public.reserved_handles;
create policy "staff manage reserved handles"
  on public.reserved_handles for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- --------------------------------- grants ----------------------------------
-- RLS decides *which* rows; these decide *whether you may ask at all*

grant usage on schema public to anon, authenticated, service_role;

grant select on
  public.profiles, public.songs, public.collections, public.comments,
  public.amens, public.follows, public.song_stats_daily, public.site_stats_daily
  to anon;

grant select, insert, update, delete on
  public.profiles, public.songs, public.collections, public.comments,
  public.loves, public.amens, public.follows, public.playlists,
  public.saved_collections, public.reports, public.play_events,
  public.reserved_handles
  to authenticated;

grant select on
  public.profiles, public.songs, public.collections, public.comments,
  public.amens, public.follows, public.song_stats_daily, public.site_stats_daily
  to authenticated;

grant usage, select on all sequences in schema public to anon, authenticated;

-- ------------------------------ column privileges ---------------------------
-- RLS decides which rows; these decide which columns. A counter is maintained by a
-- trigger, and the trigger that owns a column must be the only thing writing it.
--
-- In Postgres a table-level GRANT covers every column, and REVOKE (column) only
-- cancels a column-level grant — it does not subtract from the table-level one. So
-- the counters are closed by taking the table-level privilege back and re-granting
-- it column by column, leaving out the ones the database owns. The security-definer
-- triggers and functions that do the counting run as the table owner, so they never
-- notice; a client that tries gets "permission denied for column plays", which is a
-- better answer than a BEFORE trigger quietly putting the old value back.

revoke insert, update on public.songs from authenticated;
grant insert (
  owner_id, title, title_ar, note, maqam, root, bpm, voices, duff, duff_enter,
  passes, accent, year, tags, lines, motif_bank, audio_path, audio_mime,
  audio_bytes, duration_ms, artwork_path, status
) on public.songs to authenticated;
grant update (
  title, title_ar, note, maqam, root, bpm, voices, duff, duff_enter, passes,
  accent, year, tags, lines, motif_bank, audio_path, audio_mime, audio_bytes,
  duration_ms, artwork_path, status
) on public.songs to authenticated;
-- id, owner_id, plays, likes, notes, published_at and created_at are not writable

revoke insert, update on public.comments from authenticated;
grant insert (song_id, author_id, text, at_line) on public.comments to authenticated;
grant update (text, removed) on public.comments to authenticated;
-- amens, reports, created_at and edited_at belong to the triggers

-- the play beacon is the only door into the analytics: it dedupes, decides what
-- counts as a listen and maintains the rollups in one place. Writing events by hand
-- would produce history with no chart behind it. (Clearing your own history is a
-- feature that does not exist yet; when it does, it gets its own RPC.)
revoke insert, update, delete on public.play_events from anon, authenticated;

-- reserved handles belong to the catalogue; a client may read them, never move them
revoke insert, update, delete on public.reserved_handles from anon, authenticated;

-- the daily rollups are select-only for everybody: they were never granted write
-- access above, and record_play() maintains them as the table owner.

-- realtime: notes and counters appear in an open room without anybody refreshing
do $body$
begin
  alter publication supabase_realtime add table public.comments;
  alter publication supabase_realtime add table public.amens;
  alter publication supabase_realtime add table public.songs;
exception when others then
  raise notice 'supabase_realtime publication unavailable (%), skipping', sqlerrm;
end;
$body$;
