-- 20260808430000: Supabase default privileges grant EXECUTE on new public functions
-- to anon as well; revoke-from-PUBLIC doesn't remove it. Third instance of this trap.
revoke execute on function public.recommended_accounts(int) from anon;
