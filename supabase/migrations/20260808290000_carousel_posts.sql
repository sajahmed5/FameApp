-- ============================================================================
-- 20260808290000_carousel_posts
--
-- Carousel posts: up to 5 media per post. ADDITIVE design — posts.media_url/
-- thumbnail_url/media_type stay the COVER (item 0), so every existing surface
-- (deck ranking, grids, share cards, public pages) is untouched. The extra
-- items (positions 1..4) live in post_media; a post with no rows there is a
-- normal single-media post.
--
-- Moderation: each extra went through the media pipeline individually, so a
-- verdict exists per media key. An AFTER INSERT trigger consumes the extra's
-- verdict and, if it is WORSE than the parent post's current status, downgrades
-- the post — one flagged image flags the whole carousel; an extra with no
-- pipeline verdict at all knocks an approved post back to pending (a client
-- can't sneak unscanned media in behind an approved cover).
-- ============================================================================

create table if not exists public.post_media (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts (id) on delete cascade,
  position      integer not null check (position between 1 and 9),
  media_url     text not null,
  thumbnail_url text not null,
  media_type    text not null check (media_type in ('image', 'video')),
  created_at    timestamptz not null default now(),
  unique (post_id, position)
);
create index if not exists post_media_post on public.post_media (post_id, position);

alter table public.post_media enable row level security;
revoke all on public.post_media from anon, authenticated;

-- Visible whenever the parent post is visible to you: the subquery runs under the
-- caller's rights, so posts RLS (visibility/moderation/blocks) gates it for free.
create policy post_media_select on public.post_media for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));

-- Only the post's owner may attach media (at creation time).
create policy post_media_insert on public.post_media for insert to authenticated
  with check (exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));
create policy post_media_delete on public.post_media for delete to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));
grant select, insert, delete on public.post_media to authenticated;

-- Consume the pipeline verdict for each extra; downgrade the parent if worse.
create or replace function public.apply_pipeline_verdict_extra()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  _owner uuid; _post_status text; _status text;
  -- severity ladder: approved < pending < flagged < removed
  _rank constant jsonb := '{"approved":0,"pending":1,"flagged":2,"removed":3}'::jsonb;
begin
  select p.user_id, p.moderation_status into _owner, _post_status
    from public.posts p where p.id = new.post_id;

  select v.moderation_status into _status
    from public.pipeline_verdicts v
    where v.media_key = new.media_url and v.owner_id = _owner;

  if _status is not null then
    delete from public.pipeline_verdicts where media_key = new.media_url;
  else
    _status := 'pending';  -- no verdict: this media never went through the pipeline
  end if;

  if (_rank ->> _status)::int > (_rank ->> _post_status)::int then
    update public.posts set moderation_status = _status where id = new.post_id;
  end if;
  return new;
end $fn$;

drop trigger if exists apply_pipeline_verdict_extra on public.post_media;
create trigger apply_pipeline_verdict_extra
  after insert on public.post_media
  for each row execute function public.apply_pipeline_verdict_extra();
