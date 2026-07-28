-- Rollback for 20260728100000_following_deck

drop function if exists public.get_following_summary();
drop function if exists public.get_following_deck(integer, uuid[]);
