-- ============================================================================
-- 20260727090500_rls
-- Row Level Security for every table, plus column-level privilege hardening.
--
-- Two rules are load-bearing and must never be weakened:
--
--   RULE 1 — SWIPE ANONYMITY. `swipes` has SELECT/INSERT/DELETE policies scoped
--   to `user_id = auth.uid()` and NOTHING else. No policy, view, or function
--   returns another user's swipe rows or direction. Aggregate like/skip totals
--   live only on posts.* and are trigger-maintained.
--
--   RULE 2 — APPEND-ONLY LEDGER. `points_ledger` has SELECT(own) + INSERT(own)
--   policies only. There is deliberately no UPDATE or DELETE policy, and UPDATE
--   /DELETE are additionally REVOKEd from client roles. Corrections = negative
--   compensating rows. Balance columns are revoked from client writes entirely.
--
-- All policies target `authenticated`; `anon` gets no access (feed requires a
-- verified account). service_role bypasses RLS by design for backend/moderation.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on every table.
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.posts             enable row level security;
alter table public.tags              enable row level security;
alter table public.post_tags         enable row level security;
alter table public.user_tags         enable row level security;
alter table public.follows           enable row level security;
alter table public.swipes            enable row level security;
alter table public.comments          enable row level security;
alter table public.comment_reactions enable row level security;
alter table public.points_ledger     enable row level security;
alter table public.reports           enable row level security;
alter table public.blocks            enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Relationship helpers. SECURITY DEFINER so they can read follows/blocks
--    without recursing through those tables' own RLS. They only ever return a
--    boolean about the CURRENT user's relationship to `_other`, so they leak
--    nothing. Marked STABLE; search_path pinned.
-- ---------------------------------------------------------------------------
create or replace function public.is_blocked_with(_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.blocks
    where (blocker_id = auth.uid() and blocked_id = _other)
       or (blocker_id = _other       and blocked_id = auth.uid())
  );
$fn$;

create or replace function public.is_accepted_follower_of(_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.follows
    where follower_id = auth.uid()
      and followee_id = _owner
      and status = 'accepted'
  );
$fn$;

revoke all on function public.is_blocked_with(uuid)        from public;
revoke all on function public.is_accepted_follower_of(uuid) from public;
grant execute on function public.is_blocked_with(uuid)        to authenticated, service_role;
grant execute on function public.is_accepted_follower_of(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. profiles — readable by all (minus block pairs); insert/update own only.
--    Column grants: DOB is immutable post-signup and points columns can never
--    be set/updated by the client (they are trigger-maintained).
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (not public.is_blocked_with(id));

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, handle, display_name, bio, avatar_url, date_of_birth,
              is_private, search_radius_miles, search_location)
  on public.profiles to authenticated;
grant update (handle, display_name, bio, avatar_url,
              is_private, search_radius_miles, search_location)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 4. posts — public+approved readable by all; private readable by accepted
--    followers; owner reads all own. Block pairs hidden. Removed posts hidden
--    from everyone but the owner. Counts + moderation_status are unforgeable:
--    revoke table insert/update, grant only the content columns.
-- ---------------------------------------------------------------------------
create policy posts_select on public.posts
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      not public.is_blocked_with(user_id)
      and moderation_status <> 'removed'
      and (
        (visibility = 'public' and moderation_status = 'approved')
        or (visibility = 'private' and public.is_accepted_follower_of(user_id))
      )
    )
  );

create policy posts_insert on public.posts
  for insert to authenticated
  with check (user_id = auth.uid());

create policy posts_update on public.posts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy posts_delete on public.posts
  for delete to authenticated
  using (user_id = auth.uid());

revoke insert, update on public.posts from anon, authenticated;
grant insert (id, user_id, media_url, thumbnail_url, media_type,
              caption, alt_text, visibility, location_cell)
  on public.posts to authenticated;
grant update (caption, alt_text, visibility, location_cell)
  on public.posts to authenticated;

-- ---------------------------------------------------------------------------
-- 5. tags — global read + create; usage_count is trigger-only (no client
--    update/delete).
-- ---------------------------------------------------------------------------
create policy tags_select on public.tags
  for select to authenticated using (true);

create policy tags_insert on public.tags
  for insert to authenticated with check (true);

revoke update, delete on public.tags from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. post_tags — readable iff the parent post is readable (posts RLS filters
--    the EXISTS subquery). Insert/delete only by the post owner.
-- ---------------------------------------------------------------------------
create policy post_tags_select on public.post_tags
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));

create policy post_tags_insert on public.post_tags
  for insert to authenticated
  with check (exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));

create policy post_tags_delete on public.post_tags
  for delete to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. user_tags — a user's private interest profile. Fully self-scoped.
-- ---------------------------------------------------------------------------
create policy user_tags_select on public.user_tags
  for select to authenticated using (user_id = auth.uid());
create policy user_tags_insert on public.user_tags
  for insert to authenticated with check (user_id = auth.uid());
create policy user_tags_update on public.user_tags
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy user_tags_delete on public.user_tags
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8. follows — see rows involving yourself. You create your own follow (and
--    may only self-accept when the target is public — private accounts stay
--    'pending' until the followee accepts). Followee flips status; either side
--    can delete. Only `status` is client-updatable.
-- ---------------------------------------------------------------------------
create policy follows_select on public.follows
  for select to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid());

create policy follows_insert on public.follows
  for insert to authenticated
  with check (
    follower_id = auth.uid()
    and not public.is_blocked_with(followee_id)
    and (
      status = 'pending'
      or (status = 'accepted'
          and exists (select 1 from public.profiles pr
                       where pr.id = followee_id and pr.is_private = false))
    )
  );

create policy follows_update on public.follows
  for update to authenticated
  using (followee_id = auth.uid())
  with check (followee_id = auth.uid());

create policy follows_delete on public.follows
  for delete to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid());

revoke update on public.follows from anon, authenticated;
grant update (status) on public.follows to authenticated;

-- ---------------------------------------------------------------------------
-- 9. swipes — RULE 1. Own rows only, for every operation. No other SELECT path.
-- ---------------------------------------------------------------------------
create policy swipes_select_own on public.swipes
  for select to authenticated using (user_id = auth.uid());

create policy swipes_insert_own on public.swipes
  for insert to authenticated with check (user_id = auth.uid());

create policy swipes_delete_own on public.swipes
  for delete to authenticated using (user_id = auth.uid());

-- No UPDATE policy: an "undo" deletes the row; a re-swipe re-inserts it.
revoke update on public.swipes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. comments — readable iff parent post readable AND author hasn't blocked
--     you. Insert on readable posts as yourself. Edit body only; delete own.
-- ---------------------------------------------------------------------------
create policy comments_select on public.comments
  for select to authenticated
  using (
    not public.is_blocked_with(user_id)
    and exists (select 1 from public.posts p where p.id = post_id)
  );

create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts p where p.id = post_id)
  );

create policy comments_update on public.comments
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy comments_delete on public.comments
  for delete to authenticated
  using (user_id = auth.uid());

revoke update on public.comments from anon, authenticated;
grant update (body) on public.comments to authenticated;

-- ---------------------------------------------------------------------------
-- 11. comment_reactions — readable iff the comment is readable and the reactor
--     hasn't blocked you. Insert/delete your own.
-- ---------------------------------------------------------------------------
create policy comment_reactions_select on public.comment_reactions
  for select to authenticated
  using (
    not public.is_blocked_with(user_id)
    and exists (select 1 from public.comments c where c.id = comment_id)
  );

create policy comment_reactions_insert on public.comment_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.comments c where c.id = comment_id)
  );

create policy comment_reactions_delete on public.comment_reactions
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 12. points_ledger — RULE 2. SELECT own ONLY. The ledger is append-only AND
--     write-only through the server: clients cannot INSERT / UPDATE / DELETE it
--     directly (all three revoked, and no write policy exists). Points are
--     awarded exclusively through the SECURITY DEFINER public.award_points()
--     gateway (migration 6), which decides the delta server-side. This closes
--     the point-minting hole a client INSERT policy would otherwise leave open.
-- ---------------------------------------------------------------------------
create policy ledger_select_own on public.points_ledger
  for select to authenticated using (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy for clients, and the privileges are revoked so
-- that even a future stray policy cannot grant write access. All writes go
-- through award_points() (runs as owner) or service_role.
revoke insert, update, delete on public.points_ledger from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. reports — insert your own (always 'open'); read your own only.
--     Status transitions are moderation-only (service_role).
-- ---------------------------------------------------------------------------
create policy reports_select_own on public.reports
  for select to authenticated using (reporter_id = auth.uid());

create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'open');

revoke update, delete on public.reports from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14. blocks — only the blocker sees / manages their block rows. The blocked
--     user is not told (no read path for them). Enforcement of the block on
--     content lives in the profiles/posts/comments policies above.
-- ---------------------------------------------------------------------------
create policy blocks_select on public.blocks
  for select to authenticated using (blocker_id = auth.uid());

create policy blocks_insert on public.blocks
  for insert to authenticated with check (blocker_id = auth.uid());

create policy blocks_delete on public.blocks
  for delete to authenticated using (blocker_id = auth.uid());
