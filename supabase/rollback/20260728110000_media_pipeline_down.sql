-- Rollback for 20260728110000_media_pipeline

drop function if exists public.prune_media_upload_events(integer);
drop function if exists public.claim_media_upload_slot(integer, integer);
drop table if exists public.media_upload_events;

drop policy if exists media_delete_own       on storage.objects;
drop policy if exists media_update_own        on storage.objects;
drop policy if exists media_write_own         on storage.objects;
drop policy if exists media_read              on storage.objects;
drop policy if exists media_staging_owner_all on storage.objects;

-- Remove bucket objects first, then the buckets.
delete from storage.objects where bucket_id in ('media', 'media-staging');
delete from storage.buckets where id in ('media', 'media-staging');
