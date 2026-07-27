-- ============================================================================
-- 20260727090400_triggers
-- Denormalised-counter and updated_at maintenance.
--
-- The counter functions are SECURITY DEFINER on purpose: a user who swipes on
-- (or comments on) someone else's post is NOT the post owner, so under RLS +
-- column grants they cannot update posts.like_count / comment_count directly.
-- Running as the owner (definer) lets the trigger keep the aggregate current
-- while the base counts stay unforgeable from the client. search_path is pinned
-- to '' and every object is schema-qualified to keep the definer functions safe.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- updated_at auto-touch (plain: runs as the updating user, on their own rows).
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

create trigger set_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.posts
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.comments
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- posts.like_count / skip_count from swipes (insert / delete / direction flip).
-- ---------------------------------------------------------------------------
create or replace function public.tg_swipes_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if (tg_op = 'INSERT') then
    if new.direction = 'right' then
      update public.posts set like_count = like_count + 1 where id = new.post_id;
    else
      update public.posts set skip_count = skip_count + 1 where id = new.post_id;
    end if;
    return new;

  elsif (tg_op = 'DELETE') then
    if old.direction = 'right' then
      update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
    else
      update public.posts set skip_count = greatest(skip_count - 1, 0) where id = old.post_id;
    end if;
    return old;

  elsif (tg_op = 'UPDATE') then
    if old.direction is distinct from new.direction then
      if old.direction = 'right' then
        update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
      else
        update public.posts set skip_count = greatest(skip_count - 1, 0) where id = old.post_id;
      end if;
      if new.direction = 'right' then
        update public.posts set like_count = like_count + 1 where id = new.post_id;
      else
        update public.posts set skip_count = skip_count + 1 where id = new.post_id;
      end if;
    end if;
    return new;
  end if;
  return null;
end;
$fn$;

create trigger swipes_counts
  after insert or update or delete on public.swipes
  for each row execute function public.tg_swipes_counts();

-- ---------------------------------------------------------------------------
-- posts.comment_count from comments.
-- ---------------------------------------------------------------------------
create or replace function public.tg_comments_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if (tg_op = 'INSERT') then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
    return old;
  end if;
  return null;
end;
$fn$;

create trigger comments_count
  after insert or delete on public.comments
  for each row execute function public.tg_comments_count();

-- ---------------------------------------------------------------------------
-- tags.usage_count from post_tags.
-- ---------------------------------------------------------------------------
create or replace function public.tg_post_tags_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if (tg_op = 'INSERT') then
    update public.tags set usage_count = usage_count + 1 where id = new.tag_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.tags set usage_count = greatest(usage_count - 1, 0) where id = old.tag_id;
    return old;
  end if;
  return null;
end;
$fn$;

create trigger post_tags_usage
  after insert or delete on public.post_tags
  for each row execute function public.tg_post_tags_usage();

-- ---------------------------------------------------------------------------
-- profiles.points_balance / points_lifetime from points_ledger inserts.
-- balance  = running sum of every delta.
-- lifetime = sum of positive deltas only.
-- INSERT only — the ledger is append-only (no update/delete path exists).
-- ---------------------------------------------------------------------------
create or replace function public.tg_ledger_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.profiles
     set points_balance  = points_balance  + new.delta,
         points_lifetime = points_lifetime + greatest(new.delta, 0)
   where id = new.user_id;
  return new;
end;
$fn$;

create trigger ledger_apply
  after insert on public.points_ledger
  for each row execute function public.tg_ledger_apply();
