-- ============================================================================
-- 20260808390000_post_overlays  (step 1 of "text and stickers on video")
--
-- A photo's overlays are BURNED IN at export, so nothing needs storing. Video
-- can't be: flattening text into every frame means re-encoding on the device —
-- slow, battery-hungry, and a large native dependency. So video keeps its
-- overlays as data and draws them over the player at playback, the way
-- Instagram does.
--
-- COORDINATES ARE NORMALISED (0..1 of the media's width/height), never pixels.
-- The editor canvas, the swipe deck, the following feed, the post view and the
-- story viewer are all different sizes; anything stored in editor pixels would
-- land in the wrong place everywhere except the editor.
--
-- Shape of each element (see components/media-editor/types.ts):
--   { "kind": "text",    "text": "...", "color": "#fff", "font": "System",
--     "nx": 0.5, "ny": 0.5, "scale": 1, "rotation": 0 }
--   { "kind": "sticker", "emoji": "🎉",
--     "nx": 0.5, "ny": 0.5, "scale": 1, "rotation": 0 }
--
-- `scale` is relative to a reference size that scales with the player's width,
-- so text keeps its proportion of the frame at any playback size.
-- ============================================================================

alter table public.posts
  add column if not exists overlays jsonb not null default '[]'::jsonb;

comment on column public.posts.overlays is
  'Video text/sticker overlays drawn at playback. Positions are normalised 0..1 of the media, NOT pixels. Empty for photos, whose overlays are burned into the exported image.';

-- Keep it an array and bound the size: this is client-supplied JSON on a public
-- table, so it needs a ceiling as much as a shape.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'posts_overlays_shape'
  ) then
    alter table public.posts
      add constraint posts_overlays_shape
      check (jsonb_typeof(overlays) = 'array' and jsonb_array_length(overlays) <= 20);
  end if;
end $$;

-- Column privileges are per-column: naming an ungranted column fails the WHOLE
-- insert, which is how adding feedback_reports.screenshot_paths without its
-- grant broke reporting outright. Grant it here, in the same migration.
grant insert (overlays) on public.posts to authenticated;
grant update (overlays) on public.posts to authenticated;

-- ---------------------------------------------------------------------------
-- Read paths. get_post_detail is a direct table select client-side, so only
-- the two feed RPCs need rebuilding. Return signatures change, hence DROP.
-- Bodies are copied verbatim from 20260808100000 (get_deck) and
-- 20260808200000 (get_following_feed) with `overlays` threaded through.
-- ---------------------------------------------------------------------------

drop function if exists public.get_deck(integer, uuid[]);
create function public.get_deck(_limit integer default 20, _exclude uuid[] default '{}')
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
  tags                text[],
  overlays            jsonb
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with base as (
    select p.id, p.user_id, p.media_url, p.thumbnail_url, p.media_type, p.caption,
           p.alt_text, p.like_count, p.skip_count, p.comment_count, p.created_at,
           p.overlays
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
      (b.like_count + 1.0) / (b.like_count + b.skip_count + 2.0) as quality,
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
    coalesce(array_agg(t.name) filter (where t.name is not null), '{}') as tags,
    c.overlays
  from combined c
  join public.profiles pr on pr.id = c.user_id
  left join public.post_tags pt on pt.post_id = c.id
  left join public.tags t on t.id = pt.tag_id
  group by
    c.id, c.user_id, c.media_url, c.thumbnail_url, c.media_type, c.caption,
    c.alt_text, c.like_count, c.skip_count, c.comment_count, c.created_at, c.score,
    c.overlays, pr.handle, pr.display_name, pr.avatar_url
  order by c.score desc
  limit _limit;
$fn$;

revoke all on function public.get_deck(integer, uuid[]) from public;
grant execute on function public.get_deck(integer, uuid[]) to authenticated;

drop function if exists public.get_following_feed(integer, timestamptz);
create function public.get_following_feed(
  _limit  integer default 15,
  _before timestamptz default null
)
returns table (
  id uuid, user_id uuid, media_url text, thumbnail_url text, media_type text, caption text,
  alt_text text, like_count integer, skip_count integer, comment_count integer, created_at timestamptz,
  poster_handle text, poster_display_name text, poster_avatar_url text, tags text[],
  my_direction text, overlays jsonb
) language sql stable security definer set search_path = '' as $fn$
  with base as (
    select p.id, p.user_id, p.media_url, p.thumbnail_url, p.media_type, p.caption,
           p.alt_text, p.like_count, p.skip_count, p.comment_count, p.created_at,
           p.overlays
    from public.posts p
    join public.follows f
      on f.followee_id = p.user_id and f.follower_id = auth.uid() and f.status = 'accepted'
    where p.moderation_status = 'approved'
      and p.visibility in ('public', 'private')
      and p.user_id <> auth.uid()
      and (_before is null or p.created_at < _before)
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
           or (b.blocker_id = p.user_id and b.blocked_id = auth.uid())
      )
      and not exists (
        select 1 from public.mutes m where m.muter_id = auth.uid() and m.muted_id = p.user_id
      )
  )
  select b.id, b.user_id, b.media_url, b.thumbnail_url, b.media_type, b.caption, b.alt_text,
    b.like_count, b.skip_count, b.comment_count, b.created_at,
    pr.handle, pr.display_name, pr.avatar_url,
    coalesce(array_agg(t.name) filter (where t.name is not null), '{}') as tags,
    sw.direction as my_direction,
    b.overlays
  from base b
  join public.profiles pr on pr.id = b.user_id
  left join public.swipes sw on sw.post_id = b.id and sw.user_id = auth.uid()
  left join public.post_tags pt on pt.post_id = b.id
  left join public.tags t on t.id = pt.tag_id
  group by b.id, b.user_id, b.media_url, b.thumbnail_url, b.media_type, b.caption, b.alt_text,
    b.like_count, b.skip_count, b.comment_count, b.created_at, b.overlays,
    pr.handle, pr.display_name, pr.avatar_url, sw.direction
  order by b.created_at desc
  limit greatest(_limit, 0);
$fn$;

revoke all on function public.get_following_feed(integer, timestamptz) from public;
grant execute on function public.get_following_feed(integer, timestamptz) to authenticated;
