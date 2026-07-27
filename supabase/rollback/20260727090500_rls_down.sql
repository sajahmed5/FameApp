-- Rollback for 20260727090500_rls
-- Drops all policies + relationship helpers, restores default privileges, and
-- disables RLS. Run BEFORE the triggers/tables rollbacks.

-- profiles
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
-- posts
drop policy if exists posts_select on public.posts;
drop policy if exists posts_insert on public.posts;
drop policy if exists posts_update on public.posts;
drop policy if exists posts_delete on public.posts;
-- tags
drop policy if exists tags_select on public.tags;
drop policy if exists tags_insert on public.tags;
-- post_tags
drop policy if exists post_tags_select on public.post_tags;
drop policy if exists post_tags_insert on public.post_tags;
drop policy if exists post_tags_delete on public.post_tags;
-- user_tags
drop policy if exists user_tags_select on public.user_tags;
drop policy if exists user_tags_insert on public.user_tags;
drop policy if exists user_tags_update on public.user_tags;
drop policy if exists user_tags_delete on public.user_tags;
-- follows
drop policy if exists follows_select on public.follows;
drop policy if exists follows_insert on public.follows;
drop policy if exists follows_update on public.follows;
drop policy if exists follows_delete on public.follows;
-- swipes
drop policy if exists swipes_select_own on public.swipes;
drop policy if exists swipes_insert_own on public.swipes;
drop policy if exists swipes_delete_own on public.swipes;
-- comments
drop policy if exists comments_select on public.comments;
drop policy if exists comments_insert on public.comments;
drop policy if exists comments_update on public.comments;
drop policy if exists comments_delete on public.comments;
-- comment_reactions
drop policy if exists comment_reactions_select on public.comment_reactions;
drop policy if exists comment_reactions_insert on public.comment_reactions;
drop policy if exists comment_reactions_delete on public.comment_reactions;
-- points_ledger  (ledger_insert_own was removed in favour of award_points;
-- the drop is kept as if-exists in case an older revision applied it)
drop policy if exists ledger_select_own on public.points_ledger;
drop policy if exists ledger_insert_own on public.points_ledger;
-- reports
drop policy if exists reports_select_own on public.reports;
drop policy if exists reports_insert_own on public.reports;
-- blocks
drop policy if exists blocks_select on public.blocks;
drop policy if exists blocks_insert on public.blocks;
drop policy if exists blocks_delete on public.blocks;

-- Restore default table privileges that the migration narrowed to columns.
grant insert, update on public.profiles to authenticated;
grant insert, update on public.posts    to authenticated;
grant update, delete on public.tags      to authenticated;
grant update          on public.follows  to authenticated;
grant update          on public.swipes   to authenticated;
grant update          on public.comments to authenticated;
grant insert, update, delete on public.points_ledger to authenticated;
grant update, delete on public.reports   to authenticated;

-- Helper functions.
drop function if exists public.is_accepted_follower_of(uuid);
drop function if exists public.is_blocked_with(uuid);

-- Disable RLS.
alter table public.profiles          disable row level security;
alter table public.posts             disable row level security;
alter table public.tags              disable row level security;
alter table public.post_tags         disable row level security;
alter table public.user_tags         disable row level security;
alter table public.follows           disable row level security;
alter table public.swipes            disable row level security;
alter table public.comments          disable row level security;
alter table public.comment_reactions disable row level security;
alter table public.points_ledger     disable row level security;
alter table public.reports           disable row level security;
alter table public.blocks            disable row level security;
