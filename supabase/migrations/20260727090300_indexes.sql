-- ============================================================================
-- 20260727090300_indexes
-- The worldwide deck query is the hot path: for a given user, pull public +
-- approved posts matching their user_tags, excluding already-swiped posts,
-- ranked by points/freshness. These indexes serve that path plus the profile,
-- comment and analytics reads.
-- ============================================================================

-- Deck: "what has this user already swiped?" + points_ledger/profile history.
create index swipes_user_created_idx        on public.swipes (user_id, created_at desc);

-- Deck candidate pool: filter public+approved, order by recency.
create index posts_visibility_mod_created_idx
  on public.posts (visibility, moderation_status, created_at desc);

-- Deck tag-matching: given a tag, find posts carrying it.
create index post_tags_tag_idx              on public.post_tags (tag_id);

-- Follow graph, both directions, filtered by status (following feed + requests).
create index follows_follower_status_idx    on public.follows (follower_id, status);
create index follows_followee_status_idx    on public.follows (followee_id, status);

-- Comment threads for a post, in order.
create index comments_post_created_idx      on public.comments (post_id, created_at);

-- Points history for a user (ledger view + balance auditing).
create index points_ledger_user_created_idx on public.points_ledger (user_id, created_at desc);

-- Profile grid: a user's own posts, newest first.
create index posts_user_created_idx         on public.posts (user_id, created_at desc);

-- NOTE: the spec also lists `user_tags (user_id)`. It is intentionally NOT
-- created as a standalone index: user_tags' primary key is (user_id, tag_id),
-- whose leftmost prefix already serves every `where user_id = ?` lookup. Add
-- one only if you later need a covering index with different included columns.
