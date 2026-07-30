# Phixr — Database schema

SQL migrations for the Phixr Postgres/Supabase database. Auth credentials live in
`auth.users` (Supabase Auth); all public user data hangs off it via
`profiles.id → auth.users(id)`.

## Layout

```
supabase/
  migrations/                     applied in filename order
    20260727090100_extensions.sql   pgcrypto + postgis
    20260727090200_tables.sql       12 tables, constraints
    20260727090300_indexes.sql      hot-path indexes (deck, profile, comments)
    20260727090400_triggers.sql     counter / points / updated_at maintenance
    20260727090500_rls.sql          RLS policies + column-privilege hardening
  rollback/                       down migrations (run manually, reverse order)
    20260727090500_rls_down.sql
    20260727090400_triggers_down.sql
    20260727090300_indexes_down.sql
    20260727090200_tables_down.sql
    20260727090100_extensions_down.sql
  seed.sql                        ~20 users, ~100 posts, follows/swipes/points
  README.md
```

## Prerequisites

The first migration enables **pgcrypto** and **postgis** (for
`profiles.search_location geography(Point)`). On Supabase both install into the
`extensions` schema automatically. No other setup is required.

## Applying the migrations

### Option A — Supabase CLI (recommended)

The files already follow the Supabase migration naming convention.

```bash
# from the project root, with the CLI linked to your project
supabase db push            # applies everything in supabase/migrations in order
```

For a local stack (`supabase start`), a full rebuild + seed is:

```bash
supabase db reset           # re-runs all migrations, then supabase/seed.sql
```

To have `db reset` pick up the seed automatically, ensure `supabase/config.toml`
has:

```toml
[db.seed]
enabled = true
sql_paths = ["./seed.sql"]
```

### Option B — psql / SQL editor

Run the five migration files **in filename order**, then the seed:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260727090100_extensions.sql
psql "$DATABASE_URL" -f supabase/migrations/20260727090200_tables.sql
psql "$DATABASE_URL" -f supabase/migrations/20260727090300_indexes.sql
psql "$DATABASE_URL" -f supabase/migrations/20260727090400_triggers.sql
psql "$DATABASE_URL" -f supabase/migrations/20260727090500_rls.sql
psql "$DATABASE_URL" -f supabase/seed.sql
```

In the Supabase dashboard SQL editor, paste each file's contents in the same
order. Use the **postgres**/service connection — the seed writes to `auth.users`
and bypasses RLS.

## Rolling back

The Supabase CLI does not run down migrations automatically. Apply the rollback
files manually, in **reverse** order:

```bash
psql "$DATABASE_URL" -f supabase/rollback/20260727090500_rls_down.sql
psql "$DATABASE_URL" -f supabase/rollback/20260727090400_triggers_down.sql
psql "$DATABASE_URL" -f supabase/rollback/20260727090300_indexes_down.sql
psql "$DATABASE_URL" -f supabase/rollback/20260727090200_tables_down.sql
psql "$DATABASE_URL" -f supabase/rollback/20260727090100_extensions_down.sql   # no-op by default
```

The extensions rollback is intentionally a no-op (dropping shared postgis/pgcrypto
can cascade-break unrelated objects); drop them by hand only on a throwaway DB.

## The seed data

`seed.sql` is idempotent — it deletes everything under the `@seed.fame.test`
email domain first (which cascades), then recreates:

- 20 profiles (`user1`…`user20`), ~20% private, each with 3 interest tags
- 20 tags, ~100 tagged posts (mostly public + approved, spread over ~30 days)
- a follow graph, ~200 swipes, and points activity

The swipes and post-tags are inserted through the tables, so the **triggers run**
and `like_count` / `skip_count` / `usage_count` / `points_balance` are populated
for real — useful for analytics work too.

Seed users are **data-only**: they have no `auth.identities` rows, so they can't
sign in through GoTrue (their password is `password123` if you add identities).
Your own dev account is separate and, because none of the seed swipes belong to
it, its deck sees all ~100 posts.

## Security model (read before changing any policy)

Everything is gated by RLS. Policies target the `authenticated` role; `anon` gets
no access (the feed requires a verified account). `service_role` bypasses RLS by
design, for backend and moderation work.

Two rules are load-bearing:

1. **Swipe anonymity** — `swipes` is readable/writable only by its owner
   (`user_id = auth.uid()`). No policy, view, or function exposes who swiped or
   in which direction. Public like/skip totals live only on `posts.*`.
2. **Append-only ledger** — `points_ledger` allows SELECT-own + INSERT-own only;
   UPDATE/DELETE have no policy *and* are revoked. `points_balance` /
   `points_lifetime` are trigger-maintained and revoked from client writes.

Beyond the spec, the migration also hardens against forgery **at insert time**
via column-level GRANTs: clients cannot set `moderation_status`, the `*_count`
columns, or the points columns on INSERT or UPDATE — those are owned by triggers
and moderation tooling. See `SECURITY-REVIEW.md` for the full self-audit.

### Points are awarded server-side only

Clients have **no** write access to `points_ledger` (INSERT/UPDATE/DELETE are all
revoked). Points are granted exclusively through the `SECURITY DEFINER` gateway
`public.award_points(reason, ref_type, ref_id)` (migration
`…_points_award.sql`): the client submits only the *action*, and the server
derives the delta from `points_for_reason()`. That function body is the single
place the anti-gaming rules (dwell-time gate, per-hour diminishing returns, daily
ceiling) will be enforced — they're stubbed with clear insertion points now.

```ts
// client — award the current user for their own action
const { data: newBalance } = await supabase.rpc('award_points', {
  _reason: 'comment',
  _ref_type: 'comment',
  _ref_id: commentId,
});
```

Awardable `reason` values: `swipe` (1), `comment` (5), `comment_reply` (5),
`comment_reaction` (2). Cross-user / admin awards (e.g. the +3 a post owner earns
for *receiving* a comment — never a swipe) go through the internal, service-role
only `_award_to()` helper.

**Permanent rule:** no award path may ever write a swipe-referencing row into a
*post owner's* ledger — that would leak swipe attribution (Rule 1). The reason
whitelist has no swipe "received" entry by design.
