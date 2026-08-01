-- ============================================================================
-- 20260808420000_recommended_accounts  (feedback #34)
--
-- "Recommended for you" on the empty Accounts search tab: accounts ranked by
-- overlap between the tags of posts YOU liked (right swipes) and the tags THEY
-- post most. Approach agreed with Saj.
--
-- Scoring: for each tag, (how many of my likes carry it) × (how many of their
-- posts carry it), summed. Simple, explainable, and it degrades gracefully — a
-- brand-new user with no swipes gets the most-followed active accounts instead
-- of an empty list.
--
-- Same exclusions and return shape as search_accounts, so the client renders
-- both with one row component: never yourself, never anyone you already follow
-- or have a pending request to, never a block pair, active accounts only.
-- ============================================================================

create or replace function public.recommended_accounts(_limit int default 10)
returns table (
  id uuid, handle text, display_name text, avatar_url text,
  follower_count int, is_private boolean, follow_status text
) language sql stable security definer set search_path = '' as $fn$
  with my_tags as (
    select pt.tag_id, count(*)::int as weight
    from public.swipes s
    join public.post_tags pt on pt.post_id = s.post_id
    where s.user_id = auth.uid() and s.direction = 'right'
    group by pt.tag_id
  ),
  candidates as (
    select pr.id,
      coalesce((
        select sum(mt.weight)::bigint
        from public.posts p
        join public.post_tags pt on pt.post_id = p.id
        join my_tags mt on mt.tag_id = pt.tag_id
        where p.user_id = pr.id
          and p.moderation_status = 'approved'
      ), 0) as score,
      (select count(*)::int from public.follows f
        where f.followee_id = pr.id and f.status = 'accepted') as followers
    from public.profiles pr
    where pr.id <> auth.uid()
      and pr.account_status = 'active'
      and not exists (select 1 from public.follows f
                      where f.follower_id = auth.uid() and f.followee_id = pr.id)
      and not exists (select 1 from public.blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = pr.id)
                         or (b.blocker_id = pr.id and b.blocked_id = auth.uid()))
      -- only people who actually post: an empty account is a dead recommendation
      and exists (select 1 from public.posts p
                  where p.user_id = pr.id and p.moderation_status = 'approved')
  )
  select pr.id, pr.handle, pr.display_name, pr.avatar_url,
    c.followers, pr.is_private,
    null::text as follow_status   -- following is excluded above, pending too
  from candidates c
  join public.profiles pr on pr.id = c.id
  order by c.score desc, c.followers desc, pr.created_at desc
  limit greatest(_limit, 0);
$fn$;

revoke all on function public.recommended_accounts(int) from public;
grant execute on function public.recommended_accounts(int) to authenticated;
