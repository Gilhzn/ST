-- 0191_storage_media.sql (Phase 1.5, VAULT-002/003/004)
-- Supabase Storage bucket and object policies for the Media Vault. Guarded: skipped where the
-- `storage` schema is absent (e.g. PGlite), like the Realtime policies in 0091.
--  * bucket `media` is private (no public URLs); size cap = the video cap;
--  * clients may INSERT only the original object key allocated to them by create_upload_intent
--    (`originals/<game>/<uploader>/<id>.<ext>`) while the item is processing and the upload slot
--    is open (the media-upload function normally signs the upload with the service role);
--  * clients may SELECT (sign URLs for) only published display objects / renditions under
--    `media/<game>/<id>/` of items they may see; originals and `quarantine/` never;
--  * no UPDATE or DELETE policies: only the service role (pipeline, purge) changes objects.

-- Caller-relative object checks (granted to authenticated; used by the storage policies).
create function public.st_media_object_readable(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and p_name is not null and p_name !~ '\.\.'
     and p_name ~ '^media/[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$'
     and exists (select 1 from public.media_items m
                 where m.id = split_part(p_name, '/', 3)::uuid and m.game_id = split_part(p_name, '/', 2)::uuid
                   and m.status = 'published' and public.st_media_visible(m, auth.uid()))
$$;

create function public.st_media_object_uploadable(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and p_name is not null
     and exists (select 1 from public.media_items m
                 where m.storage_path = p_name and m.uploader_id = auth.uid() and m.status = 'processing'
                   and m.upload_expires_at > public.st_now())
$$;

revoke execute on function public.st_media_object_readable(text), public.st_media_object_uploadable(text) from public, anon;
grant execute on function public.st_media_object_readable(text), public.st_media_object_uploadable(text) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present (e.g. PGlite): skipping Media Vault storage policies';
    return;
  end if;
  execute $b$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('media', 'media', false, 209715200,
            array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                                   allowed_mime_types = excluded.allowed_mime_types
  $b$;
  execute 'drop policy if exists st_media_insert_original on storage.objects';
  execute 'drop policy if exists st_media_read_published on storage.objects';
  execute $p$
    create policy st_media_insert_original on storage.objects for insert to authenticated
      with check (bucket_id = 'media' and public.st_media_object_uploadable(name))
  $p$;
  execute $p$
    create policy st_media_read_published on storage.objects for select to authenticated
      using (bucket_id = 'media' and public.st_media_object_readable(name))
  $p$;
end $$;
