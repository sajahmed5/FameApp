-- ============================================================================
-- 20260808180000_story_delete
--
-- Let a story's owner delete it. Rather than hard-deleting the row (which would
-- orphan the media object in storage), we expire it: setting expires_at = now()
-- removes it from every read (get_stories_rail / get_user_stories both filter
-- expires_at > now()) immediately, and the existing story-reaper Edge Function
-- then deletes the media from storage and reaps the row on its next pass — the
-- same path a naturally-expired story takes.
-- ============================================================================

create or replace function public.delete_story(_story_id uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  update public.stories
  set expires_at = now()
  where id = _story_id and user_id = auth.uid();
end $fn$;
revoke all on function public.delete_story(uuid) from public;
grant execute on function public.delete_story(uuid) to authenticated;
