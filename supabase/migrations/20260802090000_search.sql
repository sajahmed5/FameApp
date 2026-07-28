-- ============================================================================
-- 20260802090000_search
-- Backend for the Search screen (spec §12): four modes — Worldwide, Local,
-- Tags, Accounts.
--
-- Posts search is Postgres full-text search (tsvector + GIN), NOT ILIKE across
-- the posts table. Every posts-returning RPC applies the SAME visibility rule as
-- the deck: approved AND (public OR own OR accepted-follower), blocks excluded
-- both ways, poster active — so a private post can NEVER surface for a
-- non-follower. Local search matches the coarse geohash cell only, never exact
-- coordinates. The search centre is relocatable (a place the user is not).
-- ============================================================================

set search_path = public, extensions;

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Relocatable search centre + followed-tag flag.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists search_center_location geography(Point, 4326),
  add column if not exists search_center_label     text;
comment on column public.profiles.search_center_location is
  'Optional relocated search centre (a place the user is not). Null = use search_location.';

alter table public.user_tags add column if not exists is_followed boolean not null default false;

-- ---------------------------------------------------------------------------
-- Full-text search vector on posts: caption (A) + tags (B) + alt_text (C).
-- Maintained by triggers (tags live in post_tags, so a generated column can't
-- express it). GIN index for fast @@ matching.
-- ---------------------------------------------------------------------------
alter table public.posts add column if not exists search_vector tsvector;

create or replace function public.tg_posts_search_vector()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  new.search_vector :=
       setweight(to_tsvector('english', coalesce(new.caption, '')), 'A')
    || setweight(to_tsvector('english', coalesce((
         select string_agg(t.name, ' ')
         from public.post_tags pt join public.tags t on t.id = pt.tag_id
         where pt.post_id = new.id), '')), 'B')
    || setweight(to_tsvector('english', coalesce(new.alt_text, '')), 'C');
  return new;
end $fn$;
drop trigger if exists tg_posts_search_vector on public.posts;
create trigger tg_posts_search_vector
  before insert or update of caption, alt_text on public.posts
  for each row execute function public.tg_posts_search_vector();

-- When a post's tags change, rebuild its vector (sets search_vector only, so it
-- does not re-fire the caption/alt_text trigger above).
create or replace function public.tg_post_tags_search_vector()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare _pid uuid := coalesce(new.post_id, old.post_id);
begin
  update public.posts p set search_vector =
       setweight(to_tsvector('english', coalesce(p.caption, '')), 'A')
    || setweight(to_tsvector('english', coalesce((
         select string_agg(t.name, ' ')
         from public.post_tags pt join public.tags t on t.id = pt.tag_id
         where pt.post_id = p.id), '')), 'B')
    || setweight(to_tsvector('english', coalesce(p.alt_text, '')), 'C')
  where p.id = _pid;
  return null;
end $fn$;
drop trigger if exists tg_post_tags_search_vector on public.post_tags;
create trigger tg_post_tags_search_vector
  after insert or delete on public.post_tags
  for each row execute function public.tg_post_tags_search_vector();

create index if not exists posts_search_vector_gin on public.posts using gin (search_vector);

-- Backfill existing rows.
update public.posts p set search_vector =
     setweight(to_tsvector('english', coalesce(p.caption, '')), 'A')
  || setweight(to_tsvector('english', coalesce((
       select string_agg(t.name, ' ')
       from public.post_tags pt join public.tags t on t.id = pt.tag_id
       where pt.post_id = p.id), '')), 'B')
  || setweight(to_tsvector('english', coalesce(p.alt_text, '')), 'C');

-- Trigram indexes for account + tag lookup (NOT the posts table).
create index if not exists profiles_handle_trgm on public.profiles using gin (handle extensions.gin_trgm_ops);
create index if not exists profiles_name_trgm   on public.profiles using gin (display_name extensions.gin_trgm_ops);
create index if not exists tags_name_trgm        on public.tags using gin (name extensions.gin_trgm_ops);
create index if not exists posts_location_cell   on public.posts (location_cell) where location_cell is not null;

-- ---------------------------------------------------------------------------
-- Geohash helpers for local search (match coarse cells, never coordinates).
-- geohash_encode mirrors supabase/functions/media-pipeline/geo.ts exactly so
-- the cells produced here match posts.location_cell ('gh5:<hash>').
-- ---------------------------------------------------------------------------
create or replace function public.geohash_encode(_lat double precision, _lon double precision, _precision int)
returns text language plpgsql immutable set search_path = '' as $fn$
declare
  base32 constant text := '0123456789bcdefghjkmnpqrstuvwxyz';
  idx int := 0; bit int := 0; even boolean := true; hash text := '';
  latmin double precision := -90; latmax double precision := 90;
  lonmin double precision := -180; lonmax double precision := 180; mid double precision;
begin
  while length(hash) < _precision loop
    if even then
      mid := (lonmin + lonmax) / 2;
      if _lon >= mid then idx := idx * 2 + 1; lonmin := mid; else idx := idx * 2; lonmax := mid; end if;
    else
      mid := (latmin + latmax) / 2;
      if _lat >= mid then idx := idx * 2 + 1; latmin := mid; else idx := idx * 2; latmax := mid; end if;
    end if;
    even := not even;
    bit := bit + 1;
    if bit = 5 then hash := hash || substr(base32, idx + 1, 1); bit := 0; idx := 0; end if;
  end loop;
  return hash;
end $fn$;

create or replace function public.haversine_m(_a1 double precision, _o1 double precision, _a2 double precision, _o2 double precision)
returns double precision language sql immutable set search_path = '' as $fn$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(_a2 - _a1) / 2), 2)
    + cos(radians(_a1)) * cos(radians(_a2)) * power(sin(radians(_o2 - _o1) / 2), 2)));
$fn$;

-- The set of gh5 cells intersecting a radius around a centre. Samples a grid at
-- ~half-cell spacing so coverage is complete; radius capped at 50 miles.
create or replace function public.local_cells(_lat double precision, _lon double precision, _radius_m double precision)
returns text[] language plpgsql immutable set search_path = '' as $fn$
declare
  r double precision := least(greatest(_radius_m, 500), 80467);
  dlat double precision := r / 111320.0;
  dlon double precision := r / (111320.0 * greatest(cos(radians(_lat)), 0.01));
  step_lat double precision := 2400.0 / 111320.0;
  step_lon double precision := 2400.0 / (111320.0 * greatest(cos(radians(_lat)), 0.01));
  la double precision; lo double precision;
  cells text[] := array['gh5:' || public.geohash_encode(_lat, _lon, 5)];
begin
  la := _lat - dlat;
  while la <= _lat + dlat loop
    lo := _lon - dlon;
    while lo <= _lon + dlon loop
      if public.haversine_m(_lat, _lon, la, lo) <= r then
        cells := array_append(cells, 'gh5:' || public.geohash_encode(la, lo, 5));
      end if;
      lo := lo + step_lon;
    end loop;
    la := la + step_lat;
  end loop;
  return (select array_agg(distinct c) from unnest(cells) c);
end $fn$;

-- ---------------------------------------------------------------------------
-- Worldwide post search. FTS + deck-identical visibility. Ranked by relevance,
-- then poster points balance, then recency. Returns the DeckCard shape so a tap
-- can seed a swipe deck straight from the results.
-- ---------------------------------------------------------------------------
create or replace function public.search_posts(_q text, _limit int default 24, _offset int default 0)
returns table (
  id uuid, user_id uuid, media_url text, thumbnail_url text, media_type text, caption text,
  alt_text text, like_count int, skip_count int, comment_count int, created_at timestamptz,
  poster_handle text, poster_display_name text, poster_avatar_url text, tags text[]
) language sql stable security definer set search_path = '' as $fn$
  with q as (select websearch_to_tsquery('english', coalesce(_q, '')) as tsq),
  matched as (
    select p.id, ts_rank(p.search_vector, (select tsq from q)) as rank, p.created_at, p.user_id
    from public.posts p
    where (select tsq from q) is not null
      and p.search_vector @@ (select tsq from q)
      and p.moderation_status = 'approved'
      and (
        p.visibility = 'public'
        or p.user_id = auth.uid()
        or exists (select 1 from public.follows f
                   where f.follower_id = auth.uid() and f.followee_id = p.user_id and f.status = 'accepted')
      )
      and not exists (select 1 from public.blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
                         or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
      and exists (select 1 from public.profiles pr where pr.id = p.user_id and pr.account_status = 'active')
  )
  select p.id, p.user_id, p.media_url, p.thumbnail_url, p.media_type, p.caption, p.alt_text,
    p.like_count, p.skip_count, p.comment_count, p.created_at,
    pr.handle, pr.display_name, pr.avatar_url,
    coalesce(array_agg(t.name) filter (where t.name is not null), '{}')
  from matched m
  join public.posts p on p.id = m.id
  join public.profiles pr on pr.id = p.user_id
  left join public.post_tags pt on pt.post_id = p.id
  left join public.tags t on t.id = pt.tag_id
  group by p.id, pr.handle, pr.display_name, pr.avatar_url, pr.points_balance, m.rank
  order by m.rank desc, pr.points_balance desc, p.created_at desc
  limit greatest(_limit, 0) offset greatest(_offset, 0);
$fn$;

-- Local search: the same, restricted to posts whose coarse cell falls within the
-- caller's radius of their search centre (relocated centre if set, else their own
-- coarse location). Posts without a location_cell are excluded.
create or replace function public.search_posts_local(_q text, _limit int default 24, _offset int default 0)
returns table (
  id uuid, user_id uuid, media_url text, thumbnail_url text, media_type text, caption text,
  alt_text text, like_count int, skip_count int, comment_count int, created_at timestamptz,
  poster_handle text, poster_display_name text, poster_avatar_url text, tags text[]
) language sql stable security definer set search_path = '' as $fn$
  with me as (
    select coalesce(search_center_location, search_location) as centre, search_radius_miles as radius
    from public.profiles where id = auth.uid()
  ),
  cells as (
    select public.local_cells(
      extensions.st_y(centre::extensions.geometry),
      extensions.st_x(centre::extensions.geometry),
      radius * 1609.34) as arr
    from me where centre is not null
  ),
  q as (select websearch_to_tsquery('english', coalesce(_q, '')) as tsq),
  matched as (
    select p.id, ts_rank(p.search_vector, (select tsq from q)) as rank, p.created_at
    from public.posts p
    where (select tsq from q) is not null
      and p.search_vector @@ (select tsq from q)
      and p.location_cell is not null
      and p.location_cell = any(coalesce((select arr from cells), array[]::text[]))
      and p.moderation_status = 'approved'
      and (
        p.visibility = 'public'
        or p.user_id = auth.uid()
        or exists (select 1 from public.follows f
                   where f.follower_id = auth.uid() and f.followee_id = p.user_id and f.status = 'accepted')
      )
      and not exists (select 1 from public.blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
                         or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
      and exists (select 1 from public.profiles pr where pr.id = p.user_id and pr.account_status = 'active')
  )
  select p.id, p.user_id, p.media_url, p.thumbnail_url, p.media_type, p.caption, p.alt_text,
    p.like_count, p.skip_count, p.comment_count, p.created_at,
    pr.handle, pr.display_name, pr.avatar_url,
    coalesce(array_agg(t.name) filter (where t.name is not null), '{}')
  from matched m
  join public.posts p on p.id = m.id
  join public.profiles pr on pr.id = p.user_id
  left join public.post_tags pt on pt.post_id = p.id
  left join public.tags t on t.id = pt.tag_id
  group by p.id, pr.handle, pr.display_name, pr.avatar_url, pr.points_balance, m.rank
  order by m.rank desc, pr.points_balance desc, p.created_at desc
  limit greatest(_limit, 0) offset greatest(_offset, 0);
$fn$;

-- Posts for a tag page (recent first), deck-visibility-safe + paginated.
create or replace function public.search_posts_by_tag(_name text, _limit int default 24, _offset int default 0)
returns table (
  id uuid, user_id uuid, media_url text, thumbnail_url text, media_type text, caption text,
  alt_text text, like_count int, skip_count int, comment_count int, created_at timestamptz,
  poster_handle text, poster_display_name text, poster_avatar_url text, tags text[]
) language sql stable security definer set search_path = '' as $fn$
  select p.id, p.user_id, p.media_url, p.thumbnail_url, p.media_type, p.caption, p.alt_text,
    p.like_count, p.skip_count, p.comment_count, p.created_at,
    pr.handle, pr.display_name, pr.avatar_url,
    coalesce(array_agg(at.name) filter (where at.name is not null), '{}')
  from public.tags tg
  join public.post_tags tpt on tpt.tag_id = tg.id
  join public.posts p on p.id = tpt.post_id
  join public.profiles pr on pr.id = p.user_id
  left join public.post_tags pt on pt.post_id = p.id
  left join public.tags at on at.id = pt.tag_id
  where tg.name = lower(_name)
    and p.moderation_status = 'approved'
    and (
      p.visibility = 'public'
      or p.user_id = auth.uid()
      or exists (select 1 from public.follows f
                 where f.follower_id = auth.uid() and f.followee_id = p.user_id and f.status = 'accepted')
    )
    and not exists (select 1 from public.blocks b
                    where (b.blocker_id = auth.uid() and b.blocked_id = p.user_id)
                       or (b.blocker_id = p.user_id and b.blocked_id = auth.uid()))
    and exists (select 1 from public.profiles pr2 where pr2.id = p.user_id and pr2.account_status = 'active')
  group by p.id, pr.handle, pr.display_name, pr.avatar_url
  order by p.created_at desc
  limit greatest(_limit, 0) offset greatest(_offset, 0);
$fn$;

-- ---------------------------------------------------------------------------
-- Accounts search: handle + display name (trigram), blocks excluded both ways.
-- ---------------------------------------------------------------------------
create or replace function public.search_accounts(_q text, _limit int default 20, _offset int default 0)
returns table (
  id uuid, handle text, display_name text, avatar_url text,
  follower_count int, is_private boolean, follow_status text
) language sql stable security definer set search_path = '' as $fn$
  select pr.id, pr.handle, pr.display_name, pr.avatar_url,
    (select count(*)::int from public.follows f where f.followee_id = pr.id and f.status = 'accepted'),
    pr.is_private,
    (select f.status from public.follows f where f.follower_id = auth.uid() and f.followee_id = pr.id)
  from public.profiles pr
  where _q <> ''
    and pr.id <> auth.uid()
    and pr.account_status = 'active'
    and (pr.handle ilike '%' || _q || '%' or pr.display_name ilike '%' || _q || '%')
    and not exists (select 1 from public.blocks b
                    where (b.blocker_id = auth.uid() and b.blocked_id = pr.id)
                       or (b.blocker_id = pr.id and b.blocked_id = auth.uid()))
  order by
    (lower(pr.handle) = lower(_q)) desc,
    extensions.similarity(pr.handle, _q) desc,
    (select count(*) from public.follows f where f.followee_id = pr.id and f.status = 'accepted') desc
  limit greatest(_limit, 0) offset greatest(_offset, 0);
$fn$;

-- ---------------------------------------------------------------------------
-- Tags: autocomplete, trending, page meta, follow/unfollow (weights user_tags).
-- ---------------------------------------------------------------------------
create or replace function public.search_tags(_q text, _limit int default 20)
returns table (name text, usage_count int, is_following boolean)
language sql stable security definer set search_path = '' as $fn$
  select t.name, t.usage_count,
    exists (select 1 from public.user_tags ut where ut.user_id = auth.uid() and ut.tag_id = t.id and ut.is_followed)
  from public.tags t
  where _q <> '' and t.name ilike _q || '%'
  order by (t.name = lower(_q)) desc, t.usage_count desc, t.name
  limit greatest(_limit, 0);
$fn$;

create or replace function public.trending_tags(_limit int default 20)
returns table (name text, usage_count int, is_following boolean)
language sql stable security definer set search_path = '' as $fn$
  select t.name, t.usage_count,
    exists (select 1 from public.user_tags ut where ut.user_id = auth.uid() and ut.tag_id = t.id and ut.is_followed)
  from public.tags t
  where t.usage_count > 0
  order by t.usage_count desc, t.name
  limit greatest(_limit, 0);
$fn$;

create or replace function public.get_tag_meta(_name text)
returns table (name text, post_count int, is_following boolean)
language sql stable security definer set search_path = '' as $fn$
  select t.name, t.usage_count,
    exists (select 1 from public.user_tags ut where ut.user_id = auth.uid() and ut.tag_id = t.id and ut.is_followed)
  from public.tags t where t.name = lower(_name);
$fn$;

create or replace function public.follow_tag(_name text)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare _tid uuid;
begin
  select id into _tid from public.tags where name = lower(_name);
  if _tid is null then raise exception 'unknown tag %', _name; end if;
  insert into public.user_tags (user_id, tag_id, weight, is_followed)
    values (auth.uid(), _tid, 3.0, true)
    on conflict (user_id, tag_id)
    do update set is_followed = true, weight = greatest(public.user_tags.weight, 3.0);
  return true;
end $fn$;

create or replace function public.unfollow_tag(_name text)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare _tid uuid;
begin
  select id into _tid from public.tags where name = lower(_name);
  if _tid is null then return false; end if;
  update public.user_tags set is_followed = false where user_id = auth.uid() and tag_id = _tid;
  return true;
end $fn$;

-- ---------------------------------------------------------------------------
-- Relocatable search centre + radius (SECURITY DEFINER so no column grants).
-- ---------------------------------------------------------------------------
create or replace function public.set_search_center(_lat double precision, _lon double precision, _label text)
returns void language sql security definer set search_path = '' as $fn$
  update public.profiles set
    search_center_location = extensions.st_setsrid(extensions.st_makepoint(_lon, _lat), 4326)::extensions.geography,
    search_center_label = _label
  where id = auth.uid();
$fn$;

create or replace function public.reset_search_center()
returns void language sql security definer set search_path = '' as $fn$
  update public.profiles set search_center_location = null, search_center_label = null where id = auth.uid();
$fn$;

create or replace function public.set_search_radius(_miles int)
returns void language sql security definer set search_path = '' as $fn$
  update public.profiles set search_radius_miles = greatest(1, least(_miles, 100)) where id = auth.uid();
$fn$;

create or replace function public.get_search_settings()
returns table (radius_miles int, center_label text, has_actual_location boolean)
language sql stable security definer set search_path = '' as $fn$
  select search_radius_miles, search_center_label, (search_location is not null)
  from public.profiles where id = auth.uid();
$fn$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
grant execute on function public.search_posts(text, int, int)          to authenticated;
grant execute on function public.search_posts_local(text, int, int)     to authenticated;
grant execute on function public.search_posts_by_tag(text, int, int)    to authenticated;
grant execute on function public.search_accounts(text, int, int)        to authenticated;
grant execute on function public.search_tags(text, int)                 to authenticated;
grant execute on function public.trending_tags(int)                     to authenticated;
grant execute on function public.get_tag_meta(text)                     to authenticated;
grant execute on function public.follow_tag(text)                       to authenticated;
grant execute on function public.unfollow_tag(text)                     to authenticated;
grant execute on function public.set_search_center(double precision, double precision, text) to authenticated;
grant execute on function public.reset_search_center()                  to authenticated;
grant execute on function public.set_search_radius(int)                 to authenticated;
grant execute on function public.get_search_settings()                  to authenticated;
