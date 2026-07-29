-- ============================================================================
-- 20260804090000_stories
-- 24-hour Stories on the Following tab. Expiry is enforced IN THE QUERY (RLS +
-- RPCs filter expires_at > now()), not just the UI. A pg_cron job hands expired
-- rows to the story-reaper Edge Function, which deletes the media from storage
-- (no orphaned files) and removes the rows.
--
-- Privacy: private accounts' stories are visible to accepted followers only, and
-- hidden from blocked users both ways. NOTE: story viewer lists are deliberately
-- NOT anonymous (unlike swipes) — the owner sees exactly who viewed.
-- ============================================================================

set search_path = public, extensions;

create table if not exists public.stories (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  media_url     text not null,
  thumbnail_url text not null,
  media_type    text not null check (media_type in ('image', 'video')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '24 hours')
);
create index if not exists stories_user_expires on public.stories (user_id, expires_at, created_at);
create index if not exists stories_expires on public.stories (expires_at);

create table if not exists public.story_views (
  story_id  uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);
create index if not exists story_views_viewer on public.story_views (viewer_id);

-- Who may see whose stories: self, or (not blocked either way AND (public OR
-- accepted follower)).
create or replace function public.can_see_stories(_viewer uuid, _owner uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select _viewer = _owner or (
    not exists (
      select 1 from public.blocks b
      where (b.blocker_id = _viewer and b.blocked_id = _owner)
         or (b.blocker_id = _owner and b.blocked_id = _viewer))
    and (
      (select not is_private from public.profiles where id = _owner)
      or exists (select 1 from public.follows f
                 where f.follower_id = _viewer and f.followee_id = _owner and f.status = 'accepted')
    )
  );
$fn$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.stories     enable row level security;
alter table public.story_views enable row level security;

-- Read only unexpired stories you're allowed to see.
create policy stories_select on public.stories for select to authenticated
  using (expires_at > now() and public.can_see_stories(auth.uid(), user_id));

-- Viewer list is NOT anonymous: the story OWNER sees who viewed; a viewer sees
-- their own view rows. (This is the opposite of the swipe rule, on purpose.)
create policy story_views_select on public.story_views for select to authenticated
  using (
    viewer_id = auth.uid()
    or exists (select 1 from public.stories s where s.id = story_id and s.user_id = auth.uid())
  );

revoke insert, update, delete on public.stories, public.story_views from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- Create a story from already-scanned pipeline output. Video is capped at 15s.
create or replace function public.create_story(
  _media_url text, _thumbnail_url text, _media_type text, _duration_seconds double precision default null)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare _me uuid := auth.uid(); _id uuid;
begin
  if _me is null then raise exception 'unauthorized'; end if;
  if _media_type not in ('image', 'video') then raise exception 'bad_media_type'; end if;
  if _media_type = 'video' and coalesce(_duration_seconds, 0) > 15.5 then raise exception 'video_too_long'; end if;
  insert into public.stories (user_id, media_url, thumbnail_url, media_type)
    values (_me, _media_url, _thumbnail_url, _media_type)
    returning id into _id;
  return _id;
end $fn$;

-- The rail: accounts with unexpired, visible stories — self first, then accounts
-- with unviewed stories, then by most recent. Includes self even with no story
-- (client shows the "add" affordance).
create or replace function public.get_stories_rail()
returns table (
  user_id uuid, handle text, display_name text, avatar_url text,
  has_story boolean, has_unviewed boolean, latest_at timestamptz, is_self boolean
) language sql stable security definer set search_path = '' as $fn$
  with owners as (
    -- me, plus everyone I accepted-follow
    select auth.uid() as uid
    union
    select f.followee_id from public.follows f where f.follower_id = auth.uid() and f.status = 'accepted'
  ),
  active as (
    select s.user_id,
           max(s.created_at) as latest_at,
           bool_or(sv.viewer_id is null and s.user_id <> auth.uid()) as has_unviewed,
           count(*) as n
    from public.stories s
    join owners o on o.uid = s.user_id
    left join public.story_views sv on sv.story_id = s.id and sv.viewer_id = auth.uid()
    where s.expires_at > now() and public.can_see_stories(auth.uid(), s.user_id)
    group by s.user_id
  )
  select p.id, p.handle, p.display_name, p.avatar_url,
    (a.n is not null and a.n > 0) as has_story,
    coalesce(a.has_unviewed, false) as has_unviewed,
    a.latest_at,
    (p.id = auth.uid()) as is_self
  from owners o
  join public.profiles p on p.id = o.uid
  left join active a on a.user_id = o.uid
  where p.id = auth.uid() or a.n > 0   -- always include self; others only if they have a story
  order by (p.id = auth.uid()) desc, coalesce(a.has_unviewed, false) desc, a.latest_at desc nulls last;
$fn$;

-- A single account's unexpired, visible stories in order, each with a viewed flag.
create or replace function public.get_user_stories(_user_id uuid)
returns table (
  id uuid, media_url text, thumbnail_url text, media_type text,
  created_at timestamptz, expires_at timestamptz, viewed boolean, is_self boolean
) language sql stable security definer set search_path = '' as $fn$
  select s.id, s.media_url, s.thumbnail_url, s.media_type, s.created_at, s.expires_at,
    (sv.viewer_id is not null) as viewed,
    (s.user_id = auth.uid()) as is_self
  from public.stories s
  left join public.story_views sv on sv.story_id = s.id and sv.viewer_id = auth.uid()
  where s.user_id = _user_id and s.expires_at > now()
    and public.can_see_stories(auth.uid(), s.user_id)
  order by s.created_at asc;
$fn$;

create or replace function public.mark_story_viewed(_story_id uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
declare _me uuid := auth.uid(); _owner uuid;
begin
  select user_id into _owner from public.stories where id = _story_id and expires_at > now();
  if _owner is null then return; end if;
  if _owner = _me then return; end if;              -- viewing your own story isn't a "view"
  if not public.can_see_stories(_me, _owner) then return; end if;
  insert into public.story_views (story_id, viewer_id) values (_story_id, _me)
    on conflict (story_id, viewer_id) do nothing;
end $fn$;

-- Own stories only: exactly who viewed, most recent first. NON-anonymous.
create or replace function public.get_story_viewers(_story_id uuid)
returns table (viewer_id uuid, handle text, display_name text, avatar_url text, viewed_at timestamptz)
language sql stable security definer set search_path = '' as $fn$
  select p.id, p.handle, p.display_name, p.avatar_url, sv.viewed_at
  from public.story_views sv
  join public.profiles p on p.id = sv.viewer_id
  where sv.story_id = _story_id
    and exists (select 1 from public.stories s where s.id = _story_id and s.user_id = auth.uid())
  order by sv.viewed_at desc;
$fn$;

grant execute on function public.create_story(text, text, text, double precision) to authenticated;
grant execute on function public.get_stories_rail()                               to authenticated;
grant execute on function public.get_user_stories(uuid)                           to authenticated;
grant execute on function public.mark_story_viewed(uuid)                          to authenticated;
grant execute on function public.get_story_viewers(uuid)                          to authenticated;
grant execute on function public.can_see_stories(uuid, uuid)                      to authenticated;

-- ---------------------------------------------------------------------------
-- Expiry reaper: pg_cron hands expired stories to the story-reaper Edge Function
-- (via pg_net) which deletes their media from storage, then the rows. Runs every
-- 15 minutes. Config/secret reused from private.config (same as send-push).
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_story_reaper()
returns void language plpgsql security definer set search_path = '' as $fn$
declare _base text; _anon text; _secret text;
begin
  if not exists (select 1 from public.stories where expires_at <= now()) then return; end if;
  select value into _base   from private.config where key = 'edge_base_url';
  select value into _anon   from private.config where key = 'anon_key';
  select value into _secret from private.config where key = 'push_webhook_secret';
  if _base is null then return; end if;
  perform net.http_post(
    url     := _base || '/functions/v1/story-reaper',
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', coalesce(_anon, ''),
      'Authorization', 'Bearer ' || coalesce(_anon, ''),
      'x-webhook-secret', coalesce(_secret, ''))
  );
end $fn$;

select cron.schedule('story-reaper', '*/15 * * * *', $$select public.dispatch_story_reaper();$$)
where not exists (select 1 from cron.job where jobname = 'story-reaper');
