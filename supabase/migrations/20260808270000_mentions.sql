-- ============================================================================
-- 20260808270000_mentions
--
-- @mentions in post captions and comments. Parsing happens in DB triggers (the
-- single place every write path passes through): extract @handle tokens, resolve
-- them to active profiles, and enqueue a 'mention' notification via the existing
-- choke point (which already handles self/blocks/coalescing). Capped at 5
-- mentions per text so a spam caption can't fan out notifications.
--
-- Post mentions fire only when the post is (or becomes) approved, so nobody is
-- notified about a post they can't open.
-- ============================================================================

-- 1) allow the new notification type (list must include every type already live —
--    'message' was added by the messages migration)
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'new_follower','follow_request','follow_accepted',
  'comment','reply','comment_reaction','reach_milestone','moderation','message','mention'));

-- 2) shared extractor → enqueue. Deliberately NO follow requirement — you can tag
--    anyone (friend, stranger, celebrity) and they're notified. The one visibility
--    gate: mentions on a PRIVATE post only notify people who can actually see it
--    (the author's accepted followers, or the author), so nobody gets a dead-end
--    notification to a post that won't open.
create or replace function public.notify_mentions(_text text, _actor uuid, _post_id uuid, _comment_id uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
declare _h text; _uid uuid; _n integer := 0; _vis text; _author uuid;
begin
  if _text is null or _text = '' then return; end if;
  if _post_id is not null then
    select p.visibility, p.user_id into _vis, _author from public.posts p where p.id = _post_id;
  end if;
  for _h in
    select distinct lower(m[1])
    from regexp_matches(_text, '@([a-zA-Z0-9_]{3,30})', 'g') as m
  loop
    select p.id into _uid from public.profiles p
      where p.handle = _h and p.account_status = 'active';
    if _uid is not null then
      if _vis = 'private' and _uid <> _author and not exists (
        select 1 from public.follows f
        where f.follower_id = _uid and f.followee_id = _author and f.status = 'accepted'
      ) then
        continue;  -- they can't see the post; don't notify
      end if;
      perform public.enqueue_notification(_uid, 'mention', _actor, _post_id, _comment_id, '{}'::jsonb);
      _n := _n + 1;
      exit when _n >= 5;
    end if;
  end loop;
end $fn$;

-- 3) posts: caption mentions, on approved insert or on the transition to approved
create or replace function public.tg_notify_post_mentions()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if (tg_op = 'INSERT' and new.moderation_status = 'approved')
     or (tg_op = 'UPDATE' and new.moderation_status = 'approved'
         and old.moderation_status is distinct from 'approved') then
    perform public.notify_mentions(new.caption, new.user_id, new.id, null);
  end if;
  return new;
end $fn$;
drop trigger if exists notify_post_mentions on public.posts;
create trigger notify_post_mentions
  after insert or update of moderation_status on public.posts
  for each row execute function public.tg_notify_post_mentions();

-- 4) comments: body mentions
create or replace function public.tg_notify_comment_mentions()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  perform public.notify_mentions(new.body, new.user_id, new.post_id, new.id);
  return new;
end $fn$;
drop trigger if exists notify_comment_mentions on public.comments;
create trigger notify_comment_mentions
  after insert on public.comments
  for each row execute function public.tg_notify_comment_mentions();
