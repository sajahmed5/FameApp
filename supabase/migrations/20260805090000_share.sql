-- ============================================================================
-- 20260805090000_share
-- The share system:
--   • share_post — in-app sharing to conversations/people as a shared_post_id
--     message. Private posts can ONLY be shared to accepted followers of the
--     poster (server-enforced). Points are awarded ONCE per post, no matter how
--     many recipients in one action.
--   • get_public_post / get_public_profile(+posts) — anon-callable reads for the
--     public web pages. They return NOTHING for private / removed / pending /
--     suspended content, so the web renders a 404 (never a login/teaser).
--   • anon storage policy so the web can sign public-post media with the anon key
--     (never the service role).
-- ============================================================================

set search_path = public, extensions;

-- 'share' is now an awardable action.
create or replace function public.points_for_reason(_reason text)
returns integer language sql immutable set search_path = '' as $fn$
  select case _reason
    when 'swipe'            then 1
    when 'comment'          then 5
    when 'comment_reply'    then 5
    when 'comment_reaction' then 2
    when 'share'            then 3
    else null
  end;
$fn$;

-- ---------------------------------------------------------------------------
-- share_post: send a post into conversations + to people, as a shared-post card.
-- ---------------------------------------------------------------------------
create or replace function public.share_post(
  _post_id uuid, _conversation_ids uuid[] default '{}', _recipient_ids uuid[] default '{}', _message text default null)
returns void language plpgsql security definer set search_path = '' as $fn$
declare
  _me uuid := auth.uid(); _poster uuid; _vis text; _mod text; _cid uuid; _uid uuid;
begin
  if _me is null then raise exception 'unauthorized'; end if;
  select user_id, visibility, moderation_status into _poster, _vis, _mod from public.posts where id = _post_id;
  if _poster is null then raise exception 'no_post'; end if;
  -- the sharer must be allowed to see the post they're sharing
  if not (_poster = _me
          or (_vis = 'public' and _mod = 'approved')
          or (_vis = 'private' and exists (select 1 from public.follows f
                where f.follower_id = _me and f.followee_id = _poster and f.status = 'accepted'))) then
    raise exception 'not_allowed';
  end if;

  -- existing conversations
  foreach _cid in array coalesce(_conversation_ids, '{}') loop
    if not public.is_conversation_member(_cid, _me) then continue; end if;
    -- private post: every OTHER member must be an accepted follower of the poster
    if _vis = 'private' and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = _cid and m.user_id <> _me and m.user_id <> _poster
        and not exists (select 1 from public.follows f
              where f.follower_id = m.user_id and f.followee_id = _poster and f.status = 'accepted')
    ) then raise exception 'private_share_not_allowed'; end if;
    perform public.send_message(_cid, _message, null, _post_id, null);
  end loop;

  -- new direct recipients
  foreach _uid in array coalesce(_recipient_ids, '{}') loop
    if _uid = _me then continue; end if;
    if _vis = 'private' and not exists (select 1 from public.follows f
          where f.follower_id = _uid and f.followee_id = _poster and f.status = 'accepted') then
      raise exception 'private_share_not_allowed';
    end if;
    _cid := public.start_direct(_uid);
    perform public.send_message(_cid, _message, null, _post_id, null);
  end loop;

  -- award ONCE per post (covers multi-recipient and repeat shares)
  if not exists (select 1 from public.points_ledger
                 where user_id = _me and reason = 'share' and ref_id = _post_id) then
    perform public.award_points('share', 'post', _post_id);
  end if;
end $fn$;
grant execute on function public.share_post(uuid, uuid[], uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- Public (anon) reads for the web. Return rows ONLY for content that is safe to
-- show publicly; everything else yields zero rows → the web renders a 404.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_post(_id uuid)
returns table (
  id uuid, media_url text, thumbnail_url text, media_type text, caption text, alt_text text,
  tags text[], poster_handle text, poster_display_name text, poster_avatar_url text, created_at timestamptz
) language sql stable security definer set search_path = '' as $fn$
  select p.id, p.media_url, p.thumbnail_url, p.media_type, p.caption, p.alt_text,
    coalesce(array_agg(t.name) filter (where t.name is not null), '{}'),
    pr.handle, pr.display_name, pr.avatar_url, p.created_at
  from public.posts p
  join public.profiles pr on pr.id = p.user_id
  left join public.post_tags pt on pt.post_id = p.id
  left join public.tags t on t.id = pt.tag_id
  where p.id = _id
    and p.visibility = 'public'
    and p.moderation_status = 'approved'
    and pr.account_status = 'active'
  group by p.id, pr.handle, pr.display_name, pr.avatar_url;
$fn$;

create or replace function public.get_public_profile(_handle text)
returns table (handle text, display_name text, avatar_url text, bio text, follower_count int, post_count int)
language sql stable security definer set search_path = '' as $fn$
  select pr.handle, pr.display_name, pr.avatar_url, pr.bio,
    (select count(*)::int from public.follows f where f.followee_id = pr.id and f.status = 'accepted'),
    (select count(*)::int from public.posts p where p.user_id = pr.id and p.visibility = 'public' and p.moderation_status = 'approved')
  from public.profiles pr
  where pr.handle = lower(_handle) and pr.account_status = 'active' and pr.is_private = false;
$fn$;

create or replace function public.get_public_profile_posts(_handle text, _limit int default 24)
returns table (id uuid, thumbnail_url text, media_type text)
language sql stable security definer set search_path = '' as $fn$
  select p.id, p.thumbnail_url, p.media_type
  from public.posts p
  join public.profiles pr on pr.id = p.user_id
  where pr.handle = lower(_handle) and pr.account_status = 'active' and pr.is_private = false
    and p.visibility = 'public' and p.moderation_status = 'approved'
  order by p.created_at desc
  limit greatest(_limit, 0);
$fn$;

grant execute on function public.get_public_post(uuid)                to anon, authenticated;
grant execute on function public.get_public_profile(text)             to anon, authenticated;
grant execute on function public.get_public_profile_posts(text, int)  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Anon may read (→ sign) media that belongs to a public, approved, active post.
-- Lets the web sign image URLs with the anon key; nothing private is exposed.
-- ---------------------------------------------------------------------------
drop policy if exists media_read_public_anon on storage.objects;
create policy media_read_public_anon on storage.objects for select to anon
  using (
    bucket_id = 'media' and exists (
      select 1 from public.posts p
      join public.profiles pr on pr.id = p.user_id
      where (p.media_url = storage.objects.name or p.thumbnail_url = storage.objects.name)
        and p.visibility = 'public' and p.moderation_status = 'approved' and pr.account_status = 'active'
    )
  );
