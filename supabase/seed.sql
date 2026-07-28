-- ============================================================================
-- seed.sql — development data for building the deck against.
--
-- Creates ~20 test users, ~100 tagged posts, follow/swipe/points activity.
-- Runs as a privileged role (postgres / service_role) so it bypasses RLS.
-- Idempotent: it first deletes anything under the @seed.fame.test domain,
-- which cascades through profiles -> posts -> tags junctions -> swipes -> etc.
--
-- Seed users' password is 'password123', but note they have no auth.identities
-- rows, so they are for DATA only — to actually sign in, create a user through
-- Supabase Auth (or add identities yourself). Your real dev account is separate
-- and will see all 100 posts in its deck (none are pre-swiped by you).
-- ============================================================================

-- 0. Clean previous seed (cascades to everything owned by these users).
delete from auth.users where email like '%@seed.fame.test';

-- 1. Auth users (minimal viable columns for the FK + optional password login).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
select
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'user' || g || '@seed.fame.test',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  now() - make_interval(days => g),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
from generate_series(1, 20) as g;

-- 2. Profiles (handle/display derived from the seed email local-part).
insert into public.profiles (id, handle, display_name, bio, date_of_birth, is_private)
select
  u.id,
  split_part(u.email, '@', 1),                              -- user1 .. user20
  initcap(split_part(u.email, '@', 1)),                     -- User1 .. User20
  'Seed creator ' || split_part(u.email, '@', 1),
  (date '1990-01-01' + ((random() * 4000)::int)),           -- adult DOBs
  (random() < 0.2)                                          -- ~20% private
from auth.users u
where u.email like '%@seed.fame.test';

-- 3. Tags (global). usage_count is maintained by trigger from post_tags.
insert into public.tags (name)
values
  ('nature'), ('travel'), ('food'), ('art'), ('fitness'),
  ('music'), ('tech'), ('fashion'), ('pets'), ('gaming'),
  ('photography'), ('coffee'), ('street'), ('sunset'), ('architecture'),
  ('fitness'), ('diy'), ('books'), ('cars'), ('dance')
on conflict (name) do nothing;

-- 4. Interest profiles: 3 random tags per user.
insert into public.user_tags (user_id, tag_id, weight)
select p.id, t.id, (0.5 + random())::real
from public.profiles p
cross join lateral (select id from public.tags order by random() limit 3) t
where p.handle like 'user%'
on conflict (user_id, tag_id) do nothing;

-- 5. ~100 posts spread across all seed authors. Pick the author by indexing an
--    array of user ids with a per-row random() in the SELECT list — a LATERAL
--    `order by random() limit 1` gets evaluated ONCE by the planner and assigns
--    every post to the same author.
insert into public.posts (
  id, user_id, media_url, thumbnail_url, media_type,
  caption, visibility, moderation_status, created_at
)
select
  gen_random_uuid(),
  u.ids[1 + floor(random() * array_length(u.ids, 1))::int],
  'https://picsum.photos/seed/fame' || g || '/800/1000',
  'https://picsum.photos/seed/fame' || g || '/200/250',
  case when random() < 0.8 then 'image' else 'video' end,
  'Seed post #' || g,
  case when random() < 0.85 then 'public' else 'private' end,
  case when random() < 0.9 then 'approved' else 'pending' end,
  now() - make_interval(hours => (random() * 720)::int)     -- spread over ~30d
from generate_series(1, 100) as g
cross join (select array_agg(id) as ids from public.profiles where handle like 'user%') as u;

-- 5b. Give the video-typed posts a real, short, publicly-hosted sample clip so the
--     deck's video path is testable (the picsum URLs above are images). Thumbnail
--     stays a picsum image, acting as the poster frame.
update public.posts
set media_url = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
where media_type = 'video' and caption like 'Seed post #%';

-- 6. 1-3 tags per post (fires tags.usage_count trigger).
insert into public.post_tags (post_id, tag_id, source)
select p.id, t.id, 'user'
from public.posts p
cross join lateral (
  select id from public.tags order by random() limit (1 + (random() * 2)::int)
) t
where p.caption like 'Seed post #%'
on conflict (post_id, tag_id) do nothing;

-- 7. Follow graph: each user follows ~4 others (mostly accepted).
insert into public.follows (follower_id, followee_id, status)
select a.id, b.id, case when random() < 0.8 then 'accepted' else 'pending' end
from public.profiles a
cross join lateral (
  select id from public.profiles
  where handle like 'user%' and id <> a.id
  order by random() limit 4
) b
where a.handle like 'user%'
on conflict (follower_id, followee_id) do nothing;

-- 8. Swipes among seed users (fires like_count / skip_count triggers).
--    Only between seed users, never your dev account, so your deck stays full.
insert into public.swipes (user_id, post_id, direction)
select u.id, po.id, case when random() < 0.6 then 'right' else 'left' end
from public.profiles u
cross join lateral (
  select id from public.posts where user_id <> u.id order by random() limit 10
) po
where u.handle like 'user%'
on conflict (user_id, post_id) do nothing;

-- 9. Points activity (fires the balance/lifetime trigger). 5 entries per user.
insert into public.points_ledger (user_id, delta, reason, ref_type)
select u.id, (1 + (random() * 20)::int), 'seed_activity', 'seed'
from public.profiles u
cross join generate_series(1, 5)
where u.handle like 'user%';

-- Quick sanity readout (visible when run via psql).
do $$
declare
  n_profiles int; n_posts int; n_swipes int; n_follows int;
begin
  select count(*) into n_profiles from public.profiles where handle like 'user%';
  select count(*) into n_posts    from public.posts    where caption like 'Seed post #%';
  select count(*) into n_swipes   from public.swipes;
  select count(*) into n_follows  from public.follows;
  raise notice 'Seed complete: % profiles, % posts, % swipes, % follows',
    n_profiles, n_posts, n_swipes, n_follows;
end $$;
