-- Rollback for 20260727090600_points_award

drop function if exists public.award_points(text, text, uuid);
drop function if exists public._award_to(uuid, integer, text, text, uuid);
drop function if exists public.points_for_reason(text);

-- If you are rolling all the way back to the pre-gateway design where clients
-- inserted their own ledger rows, also restore that path (NOT recommended — it
-- re-opens point minting):
--   create policy ledger_insert_own on public.points_ledger
--     for insert to authenticated with check (user_id = auth.uid());
--   grant insert on public.points_ledger to authenticated;
