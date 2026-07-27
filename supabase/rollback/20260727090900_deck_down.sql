-- Rollback for 20260727090900_deck

drop function if exists public.undo_swipe(uuid);
drop function if exists public.record_swipe(uuid, text);
drop function if exists public.get_deck(integer, uuid[]);
