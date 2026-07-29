-- ============================================================================
-- 20260804090100_stories_overlay
-- Text/emoji overlay for stories, stored as data and rendered at view time
-- (crisp, no native screenshot dependency). One optional caption-style overlay.
-- (Column is overlay_text — `overlay` is a reserved SQL keyword.)
-- ============================================================================
set search_path = public, extensions;

alter table public.stories add column if not exists overlay_text text;

drop function if exists public.create_story(text, text, text, double precision);
create or replace function public.create_story(
  _media_url text, _thumbnail_url text, _media_type text,
  _duration_seconds double precision default null, _overlay text default null)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare _me uuid := auth.uid(); _id uuid;
begin
  if _me is null then raise exception 'unauthorized'; end if;
  if _media_type not in ('image', 'video') then raise exception 'bad_media_type'; end if;
  if _media_type = 'video' and coalesce(_duration_seconds, 0) > 15.5 then raise exception 'video_too_long'; end if;
  insert into public.stories (user_id, media_url, thumbnail_url, media_type, overlay_text)
    values (_me, _media_url, _thumbnail_url, _media_type, nullif(btrim(coalesce(_overlay, '')), ''))
    returning id into _id;
  return _id;
end $fn$;
grant execute on function public.create_story(text, text, text, double precision, text) to authenticated;

drop function if exists public.get_user_stories(uuid);
create or replace function public.get_user_stories(_user_id uuid)
returns table (
  id uuid, media_url text, thumbnail_url text, media_type text, overlay_text text,
  created_at timestamptz, expires_at timestamptz, viewed boolean, is_self boolean
) language sql stable security definer set search_path = '' as $fn$
  select s.id, s.media_url, s.thumbnail_url, s.media_type, s.overlay_text, s.created_at, s.expires_at,
    (sv.viewer_id is not null) as viewed,
    (s.user_id = auth.uid()) as is_self
  from public.stories s
  left join public.story_views sv on sv.story_id = s.id and sv.viewer_id = auth.uid()
  where s.user_id = _user_id and s.expires_at > now()
    and public.can_see_stories(auth.uid(), s.user_id)
  order by s.created_at asc;
$fn$;
grant execute on function public.get_user_stories(uuid) to authenticated;
