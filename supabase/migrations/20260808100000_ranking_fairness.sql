-- ============================================================================
-- 20260808100000_ranking_fairness
--
-- Deck ranking v2 — let good newcomers break through while popularity keeps a
-- gentle edge. Replaces get_deck's scoring with:
--
--   score = affinity×3   (personalisation: viewer's tag interest)
--         + freshness×2   (recency, ~72h decay)
--         + quality×2     (NEW: the post's own like-rate — reward good content,
--                          not just an active poster; Laplace-smoothed so a tiny
--                          sample sits at 0.5 and can't spike from one swipe)
--         + points_boost×0.5   (popularity — GENTLE, logarithmic: ln(2+points))
--         + newcomer_boost     (NEW: decaying bonus for accounts < 14 days old,
--                               so a brand-new creator gets initial reach to earn
--                               their first engagement instead of starting invisible)
--
-- Plus a per-creator DIVERSITY CAP (max 2 posts per creator per deck) so no single
-- popular user floods a viewer's deck. The explore slice (affinity = 0) is retained
-- as the guaranteed floor for content the viewer has no tag history with.
--
-- Net effect: popularity is a head-start, not a monopoly — quality + freshness +
-- the newcomer boost make the ceiling reachable by anyone with good content.
--
-- Return signature and all privacy/visibility filters are UNCHANGED.
-- ============================================================================

create or replace function public.get_deck(_limit integer default 20, _exclude uuid[] default '{}')
returns table (
  id                  uuid,
  user_id             uuid,
  media_url           text,
  thumbnail_url       text,
  media_type          text,
  caption             text,
  alt_text            text,
  like_count          integer,
  skip_count          integer,
  comment_count       integer,
  created_at          timestamptz,
  poster_handle       text,
  poster_display_name text,
  poster_avatar_url   text,
  tags                text[]
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with base as (
    select p.id, p.user_id, p.media_url, p.thumbnail_url, p.media_type, p.caption,
           p.alt_text, p.like_count, p.skip_count, p.comment_count, p.created_at
    from public.posts p
    where p.visibility = 'public'
      and p.moderation_status = 'approved'
      and p.user_id <> auth.uid()
      and p.id <> all(_exclude)
      and not exists (
        select 1 from public.swipes s where s.user_id = auth.uid() and s.post_id = p.id
      )
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
           or (b.blocker_id = p.user_id and b.blocked_id = auth.uid())
      )
  ),
  ranked as (
    select b.*,
      coalesce((
        select sum(ut.weight)
        from public.post_tags pt
        join public.user_tags ut on ut.tag_id = pt.tag_id and ut.user_id = auth.uid()
        where pt.post_id = b.id
      ), 0)::double precision as affinity,
      exp(-extract(epoch from (now() - b.created_at)) / (72.0 * 3600.0)) as freshness,
      ln(2 + coalesce(pr.points_balance, 0)) as points_boost,
      -- Laplace-smoothed like-rate: (likes+1)/(likes+skips+2) → 0.5 with no data,
      -- rises toward 1 for well-liked posts. Rewards CONTENT, not poster activity.
      (b.like_count + 1.0) / (b.like_count + b.skip_count + 2.0) as quality,
      -- Newcomer grace: 2.0 at signup, linearly decaying to 0 at 14 days.
      case
        when now() - pr.created_at < interval '14 days'
        then 2.0 * (1.0 - extract(epoch from (now() - pr.created_at)) / (14.0 * 86400.0))
        else 0.0
      end as newcomer_boost
    from base b
    join public.profiles pr on pr.id = b.user_id
  ),
  ranked2 as (
    select r.*,
      (r.affinity * 3.0
        + r.freshness * 2.0
        + r.quality * 2.0
        + r.points_boost * 0.5
        + r.newcomer_boost) as score
    from ranked r
  ),
  -- Diversity cap: at most 2 posts from any one creator in a deck.
  capped as (
    select r2.*, row_number() over (partition by r2.user_id order by r2.score desc) as creator_rn
    from ranked2 r2
  ),
  diverse as (
    select * from capped where creator_rn <= 2
  ),
  matched as (
    select * from diverse where affinity > 0
    order by score desc
    limit ceil(_limit * 0.9)
  ),
  explore as (
    select * from diverse
    where affinity = 0 and id not in (select id from matched)
    order by (freshness * 2.0 + quality * 2.0 + points_boost * 0.5 + newcomer_boost) desc, random()
    limit greatest(_limit - (select count(*) from matched), 0)
  ),
  combined as (
    select * from matched
    union all
    select * from explore
  )
  select
    c.id, c.user_id, c.media_url, c.thumbnail_url, c.media_type, c.caption,
    c.alt_text, c.like_count, c.skip_count, c.comment_count, c.created_at,
    pr.handle, pr.display_name, pr.avatar_url,
    coalesce(array_agg(t.name) filter (where t.name is not null), '{}') as tags
  from combined c
  join public.profiles pr on pr.id = c.user_id
  left join public.post_tags pt on pt.post_id = c.id
  left join public.tags t on t.id = pt.tag_id
  group by
    c.id, c.user_id, c.media_url, c.thumbnail_url, c.media_type, c.caption,
    c.alt_text, c.like_count, c.skip_count, c.comment_count, c.created_at, c.score,
    pr.handle, pr.display_name, pr.avatar_url
  order by c.score desc
  limit _limit;
$fn$;

revoke all on function public.get_deck(integer, uuid[]) from public;
grant execute on function public.get_deck(integer, uuid[]) to authenticated;
