-- ============================================================================
-- 20260807090100_data_rights
-- Private `exports` bucket that the data-export Edge Function writes a user's JSON
-- archive into and hands back as a short-lived signed link. Keys follow the same
-- {uid}/... owner-prefix convention as the media bucket, so a user's export is
-- both provable-by-key and swept by the same {uid}/ prefix on account deletion.
--
-- Deletion storage cleanup + export bundling are done server-side in the
-- delete-account / data-export Edge Functions (service role); this migration only
-- provisions the bucket + owner-scoped RLS.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;

-- Owner may read their own export objects (download via signed URL also works, but
-- this lets an authenticated client fetch directly too). No client writes — only the
-- service-role Edge Function writes here.
drop policy if exists exports_read_own on storage.objects;
create policy exports_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = auth.uid()::text);
