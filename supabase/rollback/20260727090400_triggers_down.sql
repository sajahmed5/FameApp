-- Rollback for 20260727090400_triggers

drop trigger if exists set_updated_at on public.profiles;
drop trigger if exists set_updated_at on public.posts;
drop trigger if exists set_updated_at on public.comments;
drop trigger if exists swipes_counts   on public.swipes;
drop trigger if exists comments_count  on public.comments;
drop trigger if exists post_tags_usage on public.post_tags;
drop trigger if exists ledger_apply    on public.points_ledger;

drop function if exists public.tg_set_updated_at();
drop function if exists public.tg_swipes_counts();
drop function if exists public.tg_comments_count();
drop function if exists public.tg_post_tags_usage();
drop function if exists public.tg_ledger_apply();
