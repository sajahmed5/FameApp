-- ============================================================================
-- 20260808250000_delete_post
--
-- Let a post's owner delete it. Deleting the row cascades to its comments, swipes,
-- tags, bookmarks, etc. (all FK on delete cascade). The media object in the private
-- bucket is left for storage reaping — with no post referencing it, no signed URL is
-- ever issued, so it's inaccessible regardless.
-- ============================================================================

create or replace function public.delete_post(_id uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  delete from public.posts where id = _id and user_id = auth.uid();
end $fn$;
revoke all on function public.delete_post(uuid) from public;
grant execute on function public.delete_post(uuid) to authenticated;
