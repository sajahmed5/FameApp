-- ============================================================================
-- 20260808190000_bookmarks
--
-- Private saved posts, optionally sorted into named collections (e.g. "Travel",
-- "Food"). A post is bookmarked at most once per user; that bookmark can sit in
-- one collection or be unsorted (collection_id null). get_bookmarks(null) returns
-- everything saved ("All saved"); passing a collection id narrows it.
--
-- Both tables are strictly private to their owner — no cross-user visibility.
-- All writes go through owner-scoped SECURITY DEFINER RPCs.
-- ============================================================================

create table if not exists public.collections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
-- One collection name per user (case-insensitive), so "Food" and "food" don't split.
create unique index if not exists collections_user_name on public.collections (user_id, lower(name));

create table if not exists public.bookmarks (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  post_id       uuid not null references public.posts (id) on delete cascade,
  -- Deleting a collection just unsorts its bookmarks (they aren't lost).
  collection_id uuid references public.collections (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists bookmarks_collection on public.bookmarks (collection_id);
create index if not exists bookmarks_user_created on public.bookmarks (user_id, created_at desc);

alter table public.collections enable row level security;
alter table public.bookmarks enable row level security;
revoke all on public.collections, public.bookmarks from anon, authenticated;

-- Read is owner-only (writes are RPC-only; no direct insert/update/delete grant).
create policy collections_own on public.collections for select to authenticated using (user_id = auth.uid());
create policy bookmarks_own on public.bookmarks for select to authenticated using (user_id = auth.uid());

-- ---- mutations --------------------------------------------------------------
-- Create (or reuse) a collection by name; returns its id either way.
create or replace function public.create_collection(_name text)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare _id uuid; _n text := btrim(_name);
begin
  if _n = '' then raise exception 'empty_name'; end if;
  insert into public.collections (user_id, name) values (auth.uid(), _n)
  on conflict (user_id, lower(name)) do update set name = excluded.name
  returning id into _id;
  return _id;
end $fn$;
revoke all on function public.create_collection(text) from public;
grant execute on function public.create_collection(text) to authenticated;

create or replace function public.delete_collection(_id uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  delete from public.collections where id = _id and user_id = auth.uid();
end $fn$;
revoke all on function public.delete_collection(uuid) from public;
grant execute on function public.delete_collection(uuid) to authenticated;

-- Save a post (idempotent), assigning it to a collection or leaving it unsorted.
create or replace function public.save_bookmark(_post_id uuid, _collection_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if _collection_id is not null and not exists (
    select 1 from public.collections where id = _collection_id and user_id = auth.uid()
  ) then raise exception 'bad_collection'; end if;
  insert into public.bookmarks (user_id, post_id, collection_id)
  values (auth.uid(), _post_id, _collection_id)
  on conflict (user_id, post_id) do update set collection_id = excluded.collection_id;
end $fn$;
revoke all on function public.save_bookmark(uuid, uuid) from public;
grant execute on function public.save_bookmark(uuid, uuid) to authenticated;

create or replace function public.remove_bookmark(_post_id uuid)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  delete from public.bookmarks where user_id = auth.uid() and post_id = _post_id;
end $fn$;
revoke all on function public.remove_bookmark(uuid) from public;
grant execute on function public.remove_bookmark(uuid) to authenticated;

-- ---- reads ------------------------------------------------------------------
-- My saved state for one post: zero rows = not saved; one row = saved (+ where).
create or replace function public.get_bookmark(_post_id uuid)
returns table (collection_id uuid)
language sql stable security definer set search_path = '' as $fn$
  select b.collection_id from public.bookmarks b
  where b.user_id = auth.uid() and b.post_id = _post_id;
$fn$;
revoke all on function public.get_bookmark(uuid) from public;
grant execute on function public.get_bookmark(uuid) to authenticated;

-- My collections, each with a live count and the most-recent saved thumbnail as cover.
create or replace function public.get_collections()
returns table (id uuid, name text, item_count bigint, cover_url text, created_at timestamptz)
language sql stable security definer set search_path = '' as $fn$
  select c.id, c.name,
    (select count(*) from public.bookmarks b where b.collection_id = c.id and b.user_id = auth.uid()),
    (select p.thumbnail_url from public.bookmarks b
       join public.posts p on p.id = b.post_id
       where b.collection_id = c.id and b.user_id = auth.uid()
       order by b.created_at desc limit 1),
    c.created_at
  from public.collections c
  where c.user_id = auth.uid()
  order by c.created_at desc;
$fn$;
revoke all on function public.get_collections() from public;
grant execute on function public.get_collections() to authenticated;

-- Posts in a collection (or ALL my saved posts when _collection_id is null).
create or replace function public.get_bookmarks(_collection_id uuid default null)
returns table (id uuid, thumbnail_url text, media_type text, saved_at timestamptz)
language sql stable security definer set search_path = '' as $fn$
  select p.id, p.thumbnail_url, p.media_type, b.created_at
  from public.bookmarks b
  join public.posts p on p.id = b.post_id
  where b.user_id = auth.uid()
    and (_collection_id is null or b.collection_id = _collection_id)
    and p.moderation_status <> 'removed'
  order by b.created_at desc;
$fn$;
revoke all on function public.get_bookmarks(uuid) from public;
grant execute on function public.get_bookmarks(uuid) to authenticated;
