-- Rollback for 20260727090300_indexes

drop index if exists public.swipes_user_created_idx;
drop index if exists public.posts_visibility_mod_created_idx;
drop index if exists public.post_tags_tag_idx;
drop index if exists public.follows_follower_status_idx;
drop index if exists public.follows_followee_status_idx;
drop index if exists public.comments_post_created_idx;
drop index if exists public.points_ledger_user_created_idx;
drop index if exists public.posts_user_created_idx;
