-- ============================================================================
-- 20260727090200_tables
-- Core schema. Auth credentials stay in auth.users (Supabase Auth); public
-- profile data hangs off it via profiles.id -> auth.users(id).
--
-- search_path includes `extensions` so the unqualified geography() type
-- resolves regardless of which schema PostGIS was installed into.
-- ============================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- profiles : one row per auth user. Points columns are maintained ONLY by the
-- points_ledger trigger (see triggers migration) — direct writes are revoked.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  handle              text not null unique,
  display_name        text not null,
  bio                 text,
  avatar_url          text,
  date_of_birth       date not null,
  is_private          boolean not null default false,
  points_balance      bigint not null default 0,
  points_lifetime     bigint not null default 0,
  search_radius_miles integer not null default 5,
  search_location     geography(Point, 4326),          -- fuzzed, never exact
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- lowercase, 3-30 chars, alphanumeric + underscore
  constraint profiles_handle_format check (handle ~ '^[a-z0-9_]{3,30}$'),
  constraint profiles_radius_positive check (search_radius_miles > 0)
);

comment on column public.profiles.points_balance is
  'Materialised running sum of points_ledger.delta. Never write directly.';
comment on column public.profiles.points_lifetime is
  'Materialised sum of positive points_ledger.delta only. Never write directly.';
comment on column public.profiles.search_location is
  'Coarse/fuzzed location only. Never store exact device coordinates.';

-- ---------------------------------------------------------------------------
-- posts : uploads. Counts are trigger-maintained; moderation_status is set by
-- moderation tooling (service_role), never by the owner (enforced via grants).
-- ---------------------------------------------------------------------------
create table public.posts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  media_url         text not null,
  thumbnail_url     text not null,
  media_type        text not null check (media_type in ('image', 'video')),
  caption           text,
  alt_text          text,
  visibility        text not null default 'public' check (visibility in ('public', 'private')),
  location_cell     text,                              -- coarse grid cell string, NOT coordinates
  like_count        integer not null default 0,
  skip_count        integer not null default 0,
  comment_count     integer not null default 0,
  reach_count       integer not null default 0,
  moderation_status text not null default 'pending'
                      check (moderation_status in ('pending', 'approved', 'flagged', 'removed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on column public.posts.location_cell is
  'Coarse grid cell string only (opt-in). Never store exact coordinates.';

-- ---------------------------------------------------------------------------
-- tags : global, normalised lowercase. usage_count is trigger-maintained.
-- ---------------------------------------------------------------------------
create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  usage_count integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint tags_name_normalised check (name = lower(name) and char_length(name) between 1 and 50)
);

-- ---------------------------------------------------------------------------
-- post_tags : tags attached to a post, with provenance.
-- ---------------------------------------------------------------------------
create table public.post_tags (
  post_id    uuid not null references public.posts (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  source     text not null check (source in ('user', 'vision', 'geo')),
  created_at timestamptz not null default now(),
  primary key (post_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- user_tags : a user's interest profile (private to that user).
-- ---------------------------------------------------------------------------
create table public.user_tags (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  weight     real not null default 1.0,
  created_at timestamptz not null default now(),
  primary key (user_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- follows : follow graph with request/accept state.
-- ---------------------------------------------------------------------------
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_no_self check (follower_id <> followee_id)
);

-- ---------------------------------------------------------------------------
-- swipes : the highest-volume table. Direction is NEVER exposed to anyone but
-- the swiper (see RLS migration, rule 1). One row per (user, post): a user
-- never sees the same post twice.
-- ---------------------------------------------------------------------------
create table public.swipes (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  direction  text not null check (direction in ('left', 'right')),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- ---------------------------------------------------------------------------
-- comments : threaded via self-referencing parent_comment_id.
-- ---------------------------------------------------------------------------
create table public.comments (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references public.posts (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  parent_comment_id uuid references public.comments (id) on delete cascade,
  body              text not null check (char_length(btrim(body)) > 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- comment_reactions : emoji reactions on comments.
-- ---------------------------------------------------------------------------
create table public.comment_reactions (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, emoji)
);

-- ---------------------------------------------------------------------------
-- points_ledger : APPEND-ONLY. No updates, no deletes (see RLS migration,
-- rule 2). Corrections are compensating negative rows.
-- ---------------------------------------------------------------------------
create table public.points_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  delta      integer not null,
  reason     text not null,
  ref_type   text,
  ref_id     uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- reports : user-submitted reports on posts / users / comments.
-- ---------------------------------------------------------------------------
create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'user', 'comment')),
  target_id   uuid not null,
  reason      text not null,
  detail      text,
  status      text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- blocks : mutual content hiding is enforced in RLS, not app code.
-- ---------------------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);
