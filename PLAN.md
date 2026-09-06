# MVP Plan

Proposed feature backlog for a household meal-planner + shopping list app.
Nothing here is built yet except Phase 0 — this is a proposal to align on
before we start building features.

## Phase 0 — Infrastructure (this session)
- [x] Repo, module scaffold, boundary lint rule
- [x] Supabase client wiring (preprod)
- [x] `households` / `household_members` schema + RLS
- [x] CI (type-check, lint, test)
- [x] Branch protection on `main`/`develop`
- [x] Vercel project + environments
- [ ] `la-bonavida-prod` Supabase project (deferred until launch-ready)

## Phase 1 — Auth & households

Requirements decided in planning (see `DECISIONS.md` for the full
reasoning) — this replaces the original bullet list:

- **Sign in:** magic link only (no password). Session persists via cookies;
  re-login only needed on a new device/cleared session, not every visit.
- **Roles:** `owner` / `member` only (schema unchanged from Phase 0). A
  household may have multiple owners; any owner can rename, delete, invite
  (as either role), promote/demote any member's role, or remove any member
  including another owner — no tiebreakers.
- **Zero-owner guard (new DB invariant):** a household can never end up
  with no owners. An owner can only remove *or demote* themselves if
  another owner remains; otherwise they must promote someone else first or
  delete the household. Enforced in Postgres, not just the UI.
- **Invites:** single-use, expiring links (`household_invites`: token,
  household, role, invited_by, created_at — no status column, single-use
  is enforced by deleting the row on accept) — not tied to any email. An
  owner generates a link for a chosen role and sends it however they want,
  outside the app. Declining does nothing to the row; it stays valid until
  it expires or is revoked. Expires after 7 days, swept by a scheduled
  `pg_cron` cleanup job (built now, not deferred); revocable by any owner;
  rate-limited to 5 new links/day/household **and** 10/day/person across
  all their households; the pending-links list is owner-only. Lookup and
  accept go through two `SECURITY DEFINER` functions
  (`private.get_invite`, `accept_household_invite`) rather than a broad
  table policy, so a token can only ever be looked up one-at-a-time by
  someone who already has it — never listed. No Supabase Admin API /
  service-role key involved. Members cannot generate invite links.
- **Profile:** a `public.profiles` row (alias only, non-unique) is required
  immediately after first authentication — before onboarding or an invite
  accept/decline screen — since `auth.users`/email is never client-visible
  and other people need *something* readable to see. No auto-generated
  default; the user picks it once, and can edit it anytime after.
- **Onboarding:** a user with no household lands on "create a household."
  Someone arriving via an invite link gets its own accept/decline step
  ("you've been invited to X as Y"), signing in (and setting an alias, if
  new) first if needed. Accepting is never automatic.
- **Switching households:** URL-based (`/households/[id]/...`), no
  remembered "current household" state. RLS already refuses data for a
  household URL the user isn't a member of.
- **Household settings page:** rename, view members + roles + aliases,
  promote/demote a member, remove a member, leave (all subject to the
  zero-owner guard above), edit your own alias, plus (owners only)
  view/revoke pending invite links.
- **`household_members.user_id` references `profiles(id)`**, not
  `auth.users(id)` directly — makes "must have a profile before joining a
  household" a real DB constraint, not just a UI convention.
- **Account deletion (not a Phase 1 feature, noted for later):** blocked by
  the zero-owner guard if the user is a household's sole owner — they must
  transfer ownership or delete the household first. Intentional.
- **Testing:** add `pgTAP` for this phase's DB-level invariants (zero-owner
  guard, both rate limits, `household_invites`/`profiles` RLS boundaries,
  `accept_household_invite`) as part of the CI bar, alongside the existing
  type-check/lint/unit-test checks.
- **Indexes:** unique index on `household_invites.token`; composite
  `(household_id, created_at)` and `(invited_by, created_at)` indexes
  (serve both rate-limit checks and the pending-invites list).
- **Cleanup job:** `pg_cron`, once daily.
- **Data layer:** roster and pending-invites list are each one joined
  query — no N+1 per-member/per-invite profile fetches.
- **Fetching:** Server Components fetch data during render; mutations go
  through Server Actions from small Client Component buttons/forms — see
  `CLAUDE.md` for the standing convention.

## Phase 2 — Recipes
- Create/edit/delete a recipe (title, servings, instructions)
- Attach ingredients + quantities to a recipe
- Browse/search recipes within a household

## Phase 3 — Ingredients
- Ingredient catalog scoped to a household (name, default unit)
- Reuse ingredients across recipes instead of retyping them

## Phase 4 — Meal plans
- Assign recipes to days of a week
- View a week at a glance
- Copy a previous week's plan as a starting point

## Phase 5 — Shopping lists
- Generate a shopping list from a meal plan's recipes (aggregate quantities
  across recipes, e.g. 2 recipes needing onions → one line item)
- Manually add/remove/check off items
- Multiple household members can see the same list update live

## Phase 6 — Polish
- Mobile-friendly UX polish (touch targets, mobile nav) — the app is
  responsive from the start (see `CLAUDE.md`), so this is refinement, not
  a redesign
- Installable as a PWA (manifest, icons, home-screen install; offline
  access if useful) — this will mostly be used on a phone in a kitchen or
  grocery store, and installability is purely additive metadata on top of
  the existing app, not a rewrite (see `DECISIONS.md`)
- Empty states / onboarding for a brand-new household
- Basic notifications (e.g. "shopping list updated") — email seam already
  exists (Resend via Supabase custom SMTP) once a domain is available

## Deliberately deferred
- **Extracting `shopping-lists` into a real separate service** — planned
  learning exercise once the app is stable (see `DECISIONS.md`), not part
  of the MVP itself.
- Real transactional email (Resend) — needs a domain first.
- Anything beyond meal planning / shopping lists (the CLAUDE.md mentions
  "future household management" — out of scope until the core loop works).
