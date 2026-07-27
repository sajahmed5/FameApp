-- Rollback for 20260727090200_tables
-- Dropped in reverse dependency order. CASCADE also removes any dependent
-- policies/constraints not already dropped by the RLS rollback.

drop table if exists public.blocks            cascade;
drop table if exists public.reports           cascade;
drop table if exists public.points_ledger     cascade;
drop table if exists public.comment_reactions cascade;
drop table if exists public.comments          cascade;
drop table if exists public.swipes            cascade;
drop table if exists public.follows           cascade;
drop table if exists public.user_tags         cascade;
drop table if exists public.post_tags         cascade;
drop table if exists public.tags              cascade;
drop table if exists public.posts             cascade;
drop table if exists public.profiles          cascade;
