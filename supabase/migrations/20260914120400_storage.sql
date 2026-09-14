-- ---------------------------------------------------------------------------
--  Cool Nasheed · migration 4: storage
--
--  Two public buckets. Public means the file is served straight from
--  Supabase's storage CDN with no function in the way, so a listener streaming
--  a nasheed costs nothing from the Edge Function allowance.
--
--    nasheed-audio    <uid>/<songId>.<ext>   ≤ 60 MB, audio only
--    nasheed-artwork  <uid>/<name>.<ext>     ≤  8 MB, images only
--
--  Size and MIME limits live on the bucket, so the storage API rejects bad
--  uploads before RLS is even consulted. The policies only answer one
--  question: does this path belong to you?
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('nasheed-audio', 'nasheed-audio', true, 62914560, array[
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave',
    'audio/ogg', 'audio/opus', 'audio/mp4', 'audio/m4a', 'audio/x-m4a',
    'audio/aac', 'audio/webm', 'audio/flac'
  ]),
  ('nasheed-artwork', 'nasheed-artwork', true, 8388608, array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'
  ])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------ read ---------------------------------------

drop policy if exists "nasheed audio is public" on storage.objects;
create policy "nasheed audio is public"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'nasheed-audio');

drop policy if exists "nasheed artwork is public" on storage.objects;
create policy "nasheed artwork is public"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'nasheed-artwork');

-- ------------------------------ write --------------------------------------
-- every object lives under the uploader's own uid folder

drop policy if exists "a publisher uploads into their own audio folder" on storage.objects;
create policy "a publisher uploads into their own audio folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'nasheed-audio'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "a publisher uploads into their own artwork folder" on storage.objects;
create policy "a publisher uploads into their own artwork folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'nasheed-artwork'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "a publisher may replace files in their own audio folder" on storage.objects;
create policy "a publisher may replace files in their own audio folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'nasheed-audio'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'nasheed-audio'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "a publisher may replace files in their own artwork folder" on storage.objects;
create policy "a publisher may replace files in their own artwork folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'nasheed-artwork'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'nasheed-artwork'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "a publisher may delete their own audio" on storage.objects;
create policy "a publisher may delete their own audio"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'nasheed-audio'
    and (split_part(name, '/', 1) = auth.uid()::text or public.is_staff())
  );

drop policy if exists "a publisher may delete their own artwork" on storage.objects;
create policy "a publisher may delete their own artwork"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'nasheed-artwork'
    and (split_part(name, '/', 1) = auth.uid()::text or public.is_staff())
  );
-- Clients derive public URLs themselves with
-- supabase.storage.from('nasheed-audio').getPublicUrl(path), so nothing here needs
-- to know the project host.
