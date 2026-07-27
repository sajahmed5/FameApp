# RLS self-review — swipe anonymity & ledger integrity

Audit of the policies in `20260727090500_rls.sql` against the two load-bearing
rules. Verdict first, evidence after.

**Verdict: No client role can read another user's swipe attribution, and no
client role can UPDATE or DELETE the points ledger or write the balance columns.**
Two things to fix before production are listed at the end (one is a spec-flagged
limitation, one is an interpretation to confirm).

---

## Rule 1 — swipe anonymity

**Claim: no policy, view, or function returns another user's swipe rows or
direction.**

- `swipes` has exactly three policies — `swipes_select_own`, `swipes_insert_own`,
  `swipes_delete_own` — all `using`/`with check (user_id = auth.uid())`. There is
  no SELECT policy scoped to anyone else, and no `USING (true)`.
- **No views** are created anywhere in these migrations, so there is no view that
  could re-expose `swipes` with a laxer owner.
- The only function that touches `swipes` is the trigger `tg_swipes_counts`. It is
  `SECURITY DEFINER` but writes *only* aggregates to `posts.like_count` /
  `skip_count` and returns the row to the trigger engine, not to any caller. It
  never selects swipe rows for a user.
- `posts` exposes `like_count` / `skip_count`, which are **aggregate totals with
  no per-user attribution** — exactly what the spec permits.
- No policy anywhere contains `... from public.swipes ...` in a subquery, so a
  swipe row can't leak indirectly through another table's policy.
- Duplicate-insert probing is a non-vector: the PK is `(user_id, post_id)` and a
  user can only ever insert/conflict on their **own** `user_id`, so a conflict
  error reveals nothing about others.
- The relationship helpers (`is_blocked_with`, `is_accepted_follower_of`) always
  pin one side of the relationship to `auth.uid()`, so a caller can only probe
  relationships involving themselves — and neither reads `swipes` at all.

**Only `service_role` (backend/moderation) can read all swipes.** That is
Supabase's by-design RLS bypass for the server, not a client-reachable policy, and
is required for anti-fraud / moderation. No `anon` or `authenticated` path exists.

**Forward caution (not a current leak):** the points spec awards points to the
*actor* of a swipe, never to the post's owner, so nothing swipe-related is ever
written to the owner's ledger. Keep it that way — if you ever log a "your post was
liked/skipped" points event into the **owner's** `points_ledger` with a `ref_id`
pointing at the swipe/swiper, that owner-readable row would leak attribution and
break Rule 1. Receiving-side points must stay non-attributable.

---

## Rule 2 — append-only ledger

**Claim: the ledger cannot be mutated and balances cannot be forged.**

- `points_ledger` has only `ledger_select_own` (SELECT) and `ledger_insert_own`
  (INSERT). There is **no UPDATE and no DELETE policy**, so RLS denies both for
  `authenticated`. As defense in depth, `revoke update, delete on
  public.points_ledger from anon, authenticated` removes the privilege outright.
- `profiles.points_balance` / `points_lifetime` are written **only** by the
  `SECURITY DEFINER` trigger `tg_ledger_apply` (INSERT-only on the ledger). Client
  writes are blocked two ways:
  - `revoke insert, update on public.profiles` then column-scoped grants that
    **exclude** both points columns → a client cannot set them on INSERT (they
    take the `0` default) or on UPDATE (permission denied on the column).
  - `profiles_update` is row-scoped to `id = auth.uid()`, but the column grant is
    what actually forbids touching the points columns.
- There is no client path to DELETE ledger rows via cascade: there is no
  `profiles` DELETE policy, so a user can't delete their profile (which would
  cascade); account deletion is a `service_role`/auth-admin action.
- Corrections are additive by construction: the trigger only ever *adds* `delta`
  (and `greatest(delta,0)` to lifetime), so a compensating negative row is the
  sole correction mechanism — matching the spec.

---

## Hardening applied beyond the spec (worth knowing)

The spec only required revoking direct writes to the **points** columns. The same
forgery risk applies to other trigger-owned / privileged columns, so INSERT and
UPDATE are column-scoped on `profiles`, `posts`, `follows`, `comments`, `tags`:

- **`posts`** — clients cannot set `moderation_status` or any `*_count` on INSERT
  or UPDATE. New posts always start `pending` with zero counts; counts move only
  via triggers, and approval is a moderation (`service_role`) action. This closes
  a moderation-bypass and count-forgery hole the base spec left open.
- **`follows`** — only `status` is client-updatable, and the INSERT policy only
  lets you self-`accepted` when the target account is **public**; following a
  private account is forced to `pending` until the followee accepts. Enforced in
  policy, not app code.
- **`profiles`** — `date_of_birth` is grantable on INSERT but **not** on UPDATE,
  enforcing the spec's "DOB not editable after signup without support" at the DB
  layer (support = `service_role`).
- **`reports`** — new reports are forced to `status = 'open'`; transitions are
  moderation-only.

---

## Two things to decide before production

1. **Ledger minting (spec-flagged, high priority).** Per the spec, the ledger
   currently permits INSERT-own, so a client can insert an arbitrary positive
   `delta` and mint points. The anti-gaming rules (dwell time, diminishing
   returns, daily ceilings) cannot be expressed in an RLS `WITH CHECK`. Move all
   ledger writes behind a `SECURITY DEFINER` award function (or an Edge Function
   using `service_role`) that enforces those rules, and **drop
   `ledger_insert_own`**. This does not affect Rule 2 (no mutation is possible
   either way) — it's an integrity, not an anonymity, issue.

2. **Interpretation to confirm — `profiles` + blocks.** The spec says profiles are
   "readable by all" and, separately, that a blocked user's *content* must be
   hidden both ways. I resolved the tension on the side of safety:
   `profiles_select` hides profiles between blocked pairs. If you truly want a
   blocked user to still see the blocker's profile row, change `profiles_select`'s
   `using` to `true`. (Posts/comments block-filtering is unaffected either way.)
   Relatedly, private posts also require `moderation_status <> 'removed'` so a
   removed post is never served to followers — a small safety add-on beyond the
   literal "readable by accepted followers".

---

*Assumption: these policies rely on Supabase's standard default grants to
`anon` / `authenticated` (RLS is the gate). On a vanilla Postgres without those
roles, migration 5 would need the roles created first.*
