-- Rollback for 20260728090000_comments

drop function if exists public.get_replies(uuid, integer, timestamptz);
drop function if exists public.get_comments(uuid, integer, timestamptz);
drop function if exists public.toggle_reaction(uuid, text);
drop function if exists public.delete_comment(uuid);
drop function if exists public.add_comment(uuid, text, uuid);
drop function if exists public.is_allowed_reaction(text);

-- Restore record_swipe to SECURITY INVOKER and re-open award_points to
-- authenticated (its pre-comments state).
create or replace function public.record_swipe(_post_id uuid, _direction text)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  _inserted integer;
  _balance  bigint;
begin
  if _direction not in ('left', 'right') then
    raise exception 'record_swipe: direction must be left or right';
  end if;
  insert into public.swipes (user_id, post_id, direction)
  values (auth.uid(), _post_id, _direction)
  on conflict (user_id, post_id) do nothing;
  get diagnostics _inserted = row_count;
  if _inserted > 0 then
    _balance := public.award_points('swipe', 'swipe', _post_id);
  else
    select points_balance into _balance from public.profiles where id = auth.uid();
  end if;
  return _balance;
end;
$fn$;
grant execute on function public.award_points(text, text, uuid) to authenticated;

alter table public.comments drop column if exists deleted_at;
