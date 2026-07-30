-- ============================================================================
-- 20260808240000_remove_follower_bulk_visibility
--
-- Two owner-scoped actions:
--   • remove_follower           — make someone stop following you (delete their
--                                 follow edge; they'd have to re-request/follow again)
--   • set_all_my_posts_visibility — bulk-flip every one of your posts to public or
--                                 private. Used when switching to a private account,
--                                 where you're asked whether existing (public) posts
--                                 should be made private too — because a public post
--                                 still surfaces in the worldwide feed regardless of
--                                 account privacy.
-- ============================================================================

create or replace function public.remove_follower(_follower uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  delete from public.follows
  where followee_id = auth.uid() and follower_id = _follower;
end $fn$;
revoke all on function public.remove_follower(uuid) from public;
grant execute on function public.remove_follower(uuid) to authenticated;

create or replace function public.set_all_my_posts_visibility(_visibility text)
returns integer language plpgsql security definer set search_path = '' as $fn$
declare _n integer;
begin
  if _visibility not in ('public', 'private') then raise exception 'bad_visibility'; end if;
  update public.posts
  set visibility = _visibility, updated_at = now()
  where user_id = auth.uid() and visibility <> _visibility;
  get diagnostics _n = row_count;
  return _n;
end $fn$;
revoke all on function public.set_all_my_posts_visibility(text) from public;
grant execute on function public.set_all_my_posts_visibility(text) to authenticated;
