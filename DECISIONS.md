# Decisions

An [Architecture Decision Record](https://adr.github.io/) — every
significant choice made on this project, in plain language, with the
alternatives considered and why. This is both our reference and a learning
log. New entries go at the bottom.

---

## 2026-09-06 — Stack: Next.js + TypeScript + Tailwind + Supabase + Vercel

**Decision:** Next.js (App Router, TypeScript), Tailwind CSS, Supabase
(Postgres + Auth + RLS), hosted on Vercel.

**Why:** This combination lets one person build and run a real production
app without managing servers — Vercel handles deployment and scaling,
Supabase handles the database/auth/security layer that would otherwise be
its own project. It's also one of the most common stacks in real companies
building small-to-medium web products today, so the skills transfer
directly.

---

## 2026-09-06 — Package manager: pnpm

**Decision:** pnpm instead of npm or yarn.

**Alternatives considered:** npm (default, simplest, but slower installs
and a flatter `node_modules` that lets code accidentally import packages it
never declared as a dependency); yarn (similar tradeoffs to npm here).

**Why:** pnpm is faster and uses far less disk space (packages are
hard-linked from a global store), and — more importantly for this
project — it keeps `node_modules` strict, so a module can't accidentally
depend on a package it never declared. That strictness is a small extra
layer of protection for the same "don't let things silently couple
together" goal the module-boundary rule exists for.

---

## 2026-09-06 — Module communication: in-app function calls, not events or microservices

**Decision:** Modules call each other through plain TypeScript functions
exposed from a single `index.ts` per module (the "connector" pattern). See
`ARCHITECTURE.md` for the full explanation.

**Alternatives considered:**
- **Event-based (pub/sub):** modules announce changes, others react
  independently. More decoupled, but indirect control flow and harder to
  keep database transactions consistent. Better suited to a stage where
  many independent modules must react to one action without knowing about
  each other — not our situation yet.
- **Full microservices (real network APIs):** each module becomes its own
  deployable service. True independent deployability, but real
  distributed-systems cost: no shared DB transactions (needs a "saga"
  pattern instead), service-to-service auth, API versioning, a CI/CD
  pipeline per service, and distributed tracing just to debug a
  cross-module bug. Not justified for an app a handful of people will use.

**Why this one:** it gets ~90% of the "a module can be changed without
breaking others" benefit for a fraction of the complexity, and it's how
real "modular monoliths" are built (e.g. Shopify's and GitHub's core apps).

---

## 2026-09-06 — Learn microservices later by extracting one real module, not building everything as services now

**Context:** the user's day job uses microservices, and wants to understand
that model firsthand, not just in theory.

**Decision:** stay a modular monolith for now. Once the app is stable,
deliberately extract **one** module — `shopping-lists` — into a real,
separately-deployed service (its own database schema, its own deploy, a
real network API in front of it) as a dedicated learning exercise.

**Alternatives considered:** building all 5 modules as separate services
from day one. Rejected — it directly conflicts with this project's stated
priority order (security, then simplicity, then modularity, then
efficiency): it would mean paying for distributed-systems complexity
(retries, auth between services, API versioning, per-service pipelines)
before a single feature ships.

**Why this instead:** most companies that run microservices today
(Shopify, Amazon, Netflix included) started as a monolith and only carved
out real services once a concrete need forced it — a team needing to
deploy independently, or a component needing to scale differently. Doing
one real extraction later teaches those specific pressures firsthand —
arguably better than starting distributed, since the "why" of each
microservices pattern (sagas, service contracts, tracing) will be motivated
by a real problem instead of assumed upfront.

---

## 2026-09-06 — Module boundaries enforced by lint, not memory

**Decision:** `eslint-plugin-boundaries` is configured (see
`eslint.config.mjs`) to fail the build if any file outside a module imports
anything from it other than its `index.ts`. This runs in CI on every PR.

**Why:** folder structure alone is a convention anyone (including a future
Claude Code session) can accidentally violate under time pressure. An
automated, unbypassable check is how real modular codebases actually stay
modular over time — this is the same technique tools like Nx use for
enforcing module boundaries in monorepos.

---

## 2026-09-06 — Supabase project layout: two new projects, old projects kept aside

**Context:** this project was previously attempted and abandoned/restarted.
The Supabase organization "La BonaVida" already had two projects: `La
BonaVida APP` (2026-08-22, the live backend behind an old version of the
app still in use) and `labonavida-staging` (2026-09-05, an apparent
leftover from an earlier restart attempt).

**Decision:** keep both old projects (don't touch the live one; the user
will rename both to mark them deprecated via the dashboard, since the
Supabase API has no rename endpoint). Create fresh projects for this
rebuild: `la-bonavida-preprod` (created) and `la-bonavida-prod` (deferred).

**Constraint hit:** Supabase's free plan caps an account at **2 active
projects total, across all organizations you own or administer** — not 2
per organization, contrary to initial assumption. With the old live app
counting as 1, adding both a new preprod and prod project would require 3
simultaneously active, which the free plan can't do without upgrading to
Pro (~$45–55/month for 3–4 projects, per Supabase's own pricing example).

**Alternatives considered:** (a) upgrade to Pro now to run everything
active at once — real recurring cost, rejected for now since it's not
needed yet; (b) pause the old live app to free two slots immediately —
rejected because the user wants the old app to keep working during the
rebuild.

**Resolution:** paused `labonavida-staging` (the unused leftover, free and
reversible for 90 days) to free one slot, and created `la-bonavida-preprod`
only. Creating `la-bonavida-prod` is deferred until the app is ready to
launch — at which point either the old live app can be retired (freeing its
slot) or a considered call on Pro can be made with full information.

---

## 2026-09-06 — GitHub and Vercel: new resources, old ones left running

**Context:** same restart situation — `OscarSegarra/Food-scheduler` (GitHub,
private, created 2026-09-05) and an existing Vercel project both belong to
the earlier attempt at this app, and the Vercel one is still serving the
live old app.

**Decision:** create a new GitHub repo and a new Vercel project for this
rebuild. Leave the old repo and old Vercel project untouched and running.

**Why:** the user explicitly wants the old app to keep working on the side
until the new one is ready to replace it, and wants the option to fall back
if needed. A custom domain can be moved from the old Vercel project to the
new one later — a domain attaches to exactly one Vercel project at a time,
so switching is a deliberate, few-minutes cutover done only once the new
app is ready, not something to wire up now.

---

## 2026-09-06 — RLS design: SECURITY DEFINER helper to avoid recursive policies

**Decision:** membership/role checks for `households` and
`household_members` go through one helper function,
`private.household_role(household_id)`, marked `SECURITY DEFINER` and kept
in a `private` schema never exposed via the API.

**Why:** a naive policy on `household_members` that queries
`household_members` to check "is the caller a member of this household"
recurses into its own RLS policy. The standard fix (per Supabase's own
guidance) is a `SECURITY DEFINER` function that bypasses RLS for that one
lookup — but only that lookup, and it always re-derives the caller's
identity from `auth.uid()` internally so it can't be tricked into checking
someone else's membership. `EXECUTE` on it is revoked from `public` and
granted only to `authenticated`.

**Bootstrapping note:** the `household_members` insert policy has a special
case allowing a user to insert themselves as `'owner'` only when the
household currently has zero members — otherwise no one could ever become
the first owner of a household they just created (owners are normally the
only ones allowed to add members).

**Primary keys:** `bigint generated always as identity`, not `uuid`, per
Postgres best practice for a single (non-distributed) database — sequential
identity columns avoid the index fragmentation that random UUIDs cause on
large tables. This can be revisited if household/recipe IDs ever need to be
unguessable in a public URL.

---

## 2026-09-06 — Email: Supabase test email now, Resend seam for later

**Decision:** use Supabase's built-in test email for local/preprod auth
flows (magic links, password resets). No real transactional email is wired
up yet.

**Why:** Supabase lets you swap in a real SMTP provider (Resend is the
plan) later via one dashboard setting, with zero code changes — so there's
no cost to deferring this until a domain is available to send from. Proton
stays the user's personal/admin inbox and will never send app email.

---

## 2026-09-06 — Environments and branch strategy

**Decision:** two fully separate Supabase projects (preprod/prod) and two
Vercel environments. `main` = production (deploys to prod Supabase + Vercel
production). `develop` = preproduction (deploys to preprod Supabase + a
Vercel preview environment). Feature branches merge into `develop` via PR;
`develop` merges into `main` via PR only after manual verification on
preprod. Branch protection enabled on both.

**Why:** this is standard practice at companies running production
software — it means a bug in a half-finished feature can never reach real
users, because it's caught on preprod (using fake/test data) before ever
touching the production database. Without this separation, every code
change would be one mistake away from corrupting real data or taking the
live app down.

---

## 2026-09-06 — CI: GitHub Actions required checks on every PR

**Decision:** every pull request runs type-checking, linting, and unit
tests via GitHub Actions (`.github/workflows/ci.yml`), required to pass
before merge.

**Why, per check:**
- **Type-check** (`tsc --noEmit`) — catches whole classes of bugs (wrong
  argument types, typos in property names) before the code ever runs,
  without needing a test for each one.
- **Lint** (ESLint, including the module-boundary rule) — catches style
  issues and, critically, catches a module boundary violation
  automatically, rather than relying on a human reviewer to notice.
- **Unit tests** — catch logic regressions: a change that breaks existing
  behavior fails immediately instead of being discovered later by a user.

This is the same gate most companies put in front of every merge — it
turns "did I break something?" from a manual guess into an automated
answer.

---

## 2026-09-06 — Repo visibility: public, to get free branch protection

**Decision:** made `la-bonavida-app` public on GitHub.

**Context:** GitHub's branch protection (blocking direct pushes, requiring
CI to pass before merge) is a paid feature (GitHub Pro, ~$4/month) for
private repositories, but free on public ones.

**Alternatives considered:** (a) pay for GitHub Pro to keep the repo
private — rejected for now, small but unnecessary recurring cost; (b) skip
branch protection and rely on discipline — rejected, defeats the point of
having CI at all (a failing check is meaningless if it can be merged
anyway).

**Why public is safe here:** no secrets are ever committed — API
keys/tokens live in `.env.local` (gitignored) and, later, in Vercel's
environment variable store, never in the repository. The `NEXT_PUBLIC_*`
Supabase URL and anon key are *designed* to be public (they're sent to
every browser that loads the app) — the database itself stays protected by
Row Level Security regardless of who can read the source code. Verified by
searching the full git history for key-shaped strings before flipping
visibility.

**What changed as a result:** both `main` and `develop` now have branch
protection — no direct pushes, no force-pushes, no branch deletion, and the
CI check (`Type-check, lint, and test`) must pass before a PR can merge.
`develop` was also set as the repo's default branch, since that's where
feature-branch PRs will normally target.

---

## 2026-09-06 — Phase 1 planning: auth method, household roles, invites, switching, onboarding

**Context:** planning session before building Phase 1 (Auth & households).

**Decision: magic-link-only sign-in.** No password, for anyone. Supabase
emails a one-time login link; clicking it starts a session that persists via
cookies (already refreshed on every request by `src/proxy.ts`) — so this
only affects how someone *starts* a session, not routine app use, which
stays logged in across opens/closes like any normal app.

**Alternatives considered:** password (own reset flow to build/secure,
reusable/leakable secret); both (most flexible, most surface area). Rejected
for now — nothing here is unrecoverable: Supabase supports adding password
sign-in to the same accounts later with no schema change and no rework of
anything built in this phase.

**Why:** the only real cost of magic-link is occasional re-login friction
(new device, cleared cookies, long inactivity) — not everyday use, since
sessions persist. That's an acceptable trade for owning zero password
storage/reset surface.

---

**Decision: household roles stay exactly `owner` / `member` (no `admin`
tier), and a household may have more than one owner.** An owner can rename
or delete the household, invite members as either role, promote/demote any
member's role, and remove any member — including another owner. There is
deliberately no tiebreaker: an owner removing or demoting another owner is
a normal, allowed action.

**New invariant this creates:** a household must never reach zero owners.
An owner may only remove *or demote* themselves if at least one other owner
remains; otherwise they must promote another member to owner first, or
delete the household instead. Both actions (remove and demote) are guarded
by the same rule, enforced in the database (RLS/constraint), not just
disabled as a button in the UI — consistent with this project's rule that
security lives in Postgres, not application discipline.

**Why no `admin` tier:** the originally proposed "admin" role would have had
identical permissions to "owner" once co-owners are allowed and there's no
tiebreaker between them — a role with no distinguishing power isn't a real
role. This also means the existing Phase 0 schema (`role in ('owner',
'member')`) needs no migration for roles themselves.

---

**Decision: invites are single-use, expiring links — not email-targeted.**
An owner generates an invite link for a chosen role (`owner` or `member`);
the app hands back a URL containing an unguessable random token
(`/invites/<token>`) that the owner sends however they want, outside the
app (text, chat, in person). It is **not** tied to any specific email
address. Whoever holds the link, once authenticated, sees "you've been
invited to **[household]** as **[role]**" and must explicitly Accept or
Decline — accepting inserts the membership row and consumes the invite in
one atomic step (a single Postgres function, not two separate calls that
could leave a half-applied state if the second one failed).

**Alternatives considered, and why both were rejected:**
- **Pending-invites keyed by email**, checked at login: silent and
  invisible until the invitee happens to log in on their own — the
  original design had no way to actually notify anyone new, since sending
  a custom email needs Resend + a domain (still deferred — see the "Email"
  decision above) and no other outbound-email path exists yet.
- **Supabase Admin `inviteUserByEmail`**: creates a real `auth.users` row
  immediately, so every invite that's never accepted (declined, ignored,
  mistyped) leaves a permanent ghost account behind. Worse, its behavior
  *depends on* whether the email is already registered (silently succeeds
  for a new email, errors "already exists" for a registered one) — any code
  path that branches on that difference leaks whether an arbitrary email
  has an account on the platform. It also needs the service-role key
  server-side, a new class of secret to guard for no real benefit once the
  leak/ghost-account problems rule it out anyway.

**Why the link model instead:** it needs no outbound email at all (the
owner distributes it themselves, by any channel), never creates an account
on our behalf (a real account only ever gets created by the person
themselves, via ordinary magic-link sign-up), and never branches on account
existence (visiting the link behaves identically either way — log in if
needed, then see the same accept/decline prompt) — so there's nothing left
to leak.

**Invite-link details:**
- **Single-use, enforced by deletion.** There is no status column
  (`accepted`/`declined`/etc.) — accepting a link deletes its row in the
  same atomic step that inserts the membership row, which is what actually
  makes it single-use (once gone, the token can't be used again). One link
  = one invite for one person; inviting several people means generating
  several links. Rejected a reusable household-wide link — it can't be
  revoked for just one person, and everyone who used it would be stuck at
  one fixed role.
- **Declining does nothing to the database.** It's a pure UI action —
  dismiss the prompt — with no row change at all. A declined link remains
  technically valid (re-visitable, re-acceptable) until it expires or an
  owner revokes it. Simpler than tracking accept/decline as separate
  states, and nothing in this app needs that history.
- **Expires after 7 days** from creation, whether it was ever opened,
  declined, or ignored. A link is a bearer credential (anyone holding it
  can join); an old one sitting in a stale chat thread shouldn't work
  indefinitely.
- **A scheduled cleanup job (`pg_cron`) deletes expired rows**, rather than
  just checking expiry at read-time and leaving stale rows to accumulate
  forever. Built now, not deferred — decided this way specifically to avoid
  leaving a known, resolvable gap for later.
- **Revocable by any owner** in the household, not just the one who
  generated it — consistent with owners being peers with no tiebreakers
  elsewhere in this design. If the generating owner later leaves, the link
  they created stays valid (it belongs to the household, not to them) —
  `invited_by` is kept only as an audit trail, not a validity condition.
- **Two-tier rate limit, both enforced in the database (a trigger
  rejecting the insert past either limit):** at most **5 new links per day
  per household**, and separately at most **10 new links per day per
  person** across every household they own. The per-household cap reflects
  that a household realistically has a handful of members, not dozens; the
  per-person cap covers someone who owns multiple households without
  multiplying their household cap by however many they own.
- **Visible only to owners** in household settings (the list of pending,
  unused links) — members don't need this to use the app.

**Lookup/accept mechanism:** a non-member visiting `/invites/<token>` has
no RLS-granted access to `household_invites` at all (that table stays
owner-only, per above) — so both the lookup ("what household/role does
this token grant?") and the accept action need to bypass normal row
visibility for that one narrow case, the same way `private.household_role`
already does for the recursion problem (see the RLS design decision
above). Two `SECURITY DEFINER` functions, not a broader table policy:
- `private.get_invite(_token text)` — returns just the household name,
  role, and expiry for an exact, unexpired token match; nothing otherwise.
  Can't be used to enumerate invites, since it only ever answers for one
  token the caller already supplies.
- `accept_household_invite(_token text)` — validates the token the same
  way, inserts the caller's `household_members` row at the invite's role,
  and deletes the invite row, all in one transaction.

A broad `using (true)` policy on `household_invites` was considered and
rejected — it would let any authenticated user list every pending invite
token for every household (not just filter to the one they're asking
about), since RLS restricts *which rows exist* for a query, not *what a
client is allowed to ask*.

**Zero-owner guard is a general invariant, not a self-action check.** The
trigger blocks removing/demoting *any* row where doing so would leave a
household with zero `owner` rows — it doesn't matter whether the actor is
removing themselves or another owner. (In practice these coincide once
there's exactly one owner left, since only owners can act at all and that
owner would have to be the one acting — but the guard is implemented as the
general rule, not the narrower coincidence, so it stays correct if that
structural assumption ever changes.) It's also **race-safe**: the trigger
locks the household's owner rows (`select ... for update`) before counting,
so two simultaneous removals/demotions of two different owners can't each
read "at least one other remains" and both proceed, leaving zero owners.
A naive count-then-allow check would have this exact race for a two-owner
household — the realistic case, since multi-owner is the point.

---

## 2026-09-06 — `public.profiles` table: required alias, not auto-generated

**Decision:** add `public.profiles(id uuid primary key references
auth.users(id) on delete cascade, alias text not null, created_at
timestamptz not null default now())`. No trigger auto-creates it — a user
inserts their own row (`with check (id = auth.uid())`) via a mandatory
"what should we call you?" step, required immediately after first
authentication, before anything else (including before an invite's
accept/decline screen if they arrived via a link). The row's existence
*is* the completion signal: any future login with a row already present
skips straight past this step. The alias is editable anytime afterward
(update policy: yourself only, alias only) — required once, never locked.
Not unique — purely a display label; two members can share the same alias.

**Why this exists at all:** `auth.users` (where email lives) is never
exposed to the client — that's Supabase's own boundary, not a choice made
here. Without a public-facing identity table, "view members" on the
household settings page, and "invited by X" on the pending-invites list,
would have nothing to display but opaque UUIDs. This was caught in review
before being built, not after.

**Alternatives considered:**
- **Auto-default from email** (e.g. the part before `@`), editable later,
  populated by a trigger on `auth.users` insert: less onboarding friction,
  but rejected — an alias is exactly the kind of thing other modules
  (recipes' `created_by`, later) will want to already exist and be
  intentional, not a byproduct of an email address.
- **A `SECURITY DEFINER` function reading `auth.users` directly** instead
  of a synced table: avoids a table to maintain, but doesn't give users
  something they chose, and doesn't compose as cleanly with recipes/other
  modules wanting to reference a person later.

**Why no trigger:** once the value has to come from the user (not
computed), there's nothing for a trigger to auto-generate — the "set your
alias" action *is* the insert. Simpler than maintaining trigger-created
placeholder rows.

**RLS:** select — yourself, or anyone you share a household with (a plain
subquery against `household_members`, no new `SECURITY DEFINER` needed,
since Phase 0's existing "any member sees the roster" policy already
covers the subquery's own access). Insert — yourself only, once. Update —
yourself only, alias only. No delete policy for clients (cascades when the
`auth.users` row is deleted).

**`household_members.user_id` is repointed to reference `public.profiles(id)`
instead of `auth.users(id)` directly** (a new migration on top of Phase 0's
schema; still transitively tied to `auth.users` via `profiles`' own foreign
key). This makes "you must have a profile before you can join a household"
a real constraint Postgres enforces, not just something the UI happens to
route through first — consistent with this project's pattern of putting
integrity in the database rather than trusting app discipline, at the cost
of one line in a migration.

**Interaction with account deletion (a future feature, not built yet):**
`household_members` cascades from `auth.users`, so deleting a user's
account cascades into deleting their `household_members` row(s). If that
row is a household's last `owner`, the zero-owner guard trigger rejects the
delete — which means the whole account-deletion transaction fails, not
just that one row. This is **intentional, decided now rather than
discovered later**: a sole owner must transfer ownership (promote someone
else) or delete the household itself before their account can be deleted.
Flagging this now so a future account-deletion feature is built around it
deliberately, rather than someone finding a confusing Postgres error the
first time it happens.

**Testing:** this phase's real business logic mostly lives in Postgres
(the zero-owner guard, both rate-limit triggers, the `household_invites`/
`profiles` RLS boundaries, `accept_household_invite`), not in TypeScript
`domain/` code — so this project's normal "unit test what's in `domain/`"
convention (see `CLAUDE.md`) doesn't reach it; `vitest` never touches a
Postgres trigger. **`pgTAP`** (a Postgres extension for SQL-level tests,
confirmed available — installable but not yet enabled — on the preprod
project) covers this instead, added to the same CI quality bar as
type-check/lint/unit tests. Without it, a later migration could silently
weaken the zero-owner guard or an RLS policy and nothing would catch it
before it reached preprod.

---

## 2026-09-06 — Phase 1 efficiency pass

**Context:** this app's real data volume will always be tiny — one
household at a time, single-digit members, a handful of invites, ever. Most
classic database-efficiency concerns (expensive scans, index-starved
lookups over large tables) don't apply here and aren't worth designing
around; the RLS design's `SECURITY DEFINER` function calls and the
`profiles` visibility subquery were checked against this reality and are
fine as designed, no change needed. The efficiency questions that actually
matter at this scale are request/round-trip count (what Vercel/Supabase
meter) and a couple of indexes that cost nothing to add now.

**Decision: two additional indexes on `household_invites`.**
- A **unique index on `token`** — not just for lookup speed but for
  correctness: it makes a token collision structurally impossible rather
  than merely astronomically unlikely.
- **`(household_id, created_at)` and `(invited_by, created_at)`** — these
  serve the two rate-limit triggers' count queries (the hottest path in
  this feature, since they run on every invite creation), and double as
  the exact index the owner-only pending-invites list needs ("unused
  invites for this household, newest first"). One pair of indexes, two
  uses each.

**Decision: the `pg_cron` cleanup job runs once daily.** The 7-day expiry
window doesn't need anything finer-grained; this was previously agreed to
exist but never given a schedule.

**Decision: data-layer guidance to avoid N+1 queries.** The household
roster (member + role + alias) and the pending-invites list (invite +
inviter's alias) must each be fetched as **one joined query** in
`households/data/`, never "fetch the list, then loop fetching each
profile separately." Noted now so it's built right the first time, not
discovered as a fix later.

**Decision: Server Components + Server Actions as the standing
data-fetching convention** (not just for Phase 1 — logged in `CLAUDE.md`
as an ongoing rule). Pages fetch data server-side, during render
(`async function Page()` calling Supabase directly), rather than as
Client Components that fetch via `useEffect` after the page has already
loaded in the browser — the latter is a real extra round trip (download
JS → run it → then start fetching) for pages that mostly just show data.
Mutations (accepting an invite, promoting a member, generating a link) go
through **Server Actions** (`'use server'` functions called from small
Client Component buttons/forms), so only the actually-interactive pieces
of a page ship JS to the browser and need `'use client'` at all — not
whole pages.

**Alternatives considered:** client-side fetching via `useEffect` for
these pages — rejected as the default, since it adds a round trip and a
loading state for data that's already known and cheap to fetch
server-side; there's no live-update requirement in Phase 1 that would
justify it. Nothing rules out a Client Component for a specific future
piece that genuinely needs it (e.g., a live-updating shopping list in a
later phase) — this is a default, not an absolute rule.

**Decision: household switching is URL-based** (`/households/[id]/...`),
with no stored "current household" preference. Switching is just navigating
to a different household's URL. No extra state to keep in sync, and it's
already impossible to see another household's data through its URL if
you're not a member — Postgres RLS refuses the row regardless of what the
app renders, the same guarantee Phase 0 established. Rejected a "remembered
last household" cookie/column as unnecessary sync state for someone who'll
realistically belong to 1-2 households.

**Decision: onboarding is just "create a household" — no email-matched
invite scanning.** Since invites are link-based, not email-targeted, there
is nothing to discover at a generic login; the link itself is the
notification, delivered by whatever channel the owner chose. A user with no
household yet lands on a "create a household" screen. Someone arriving via
an invite link (`/invites/<token>`) gets its own dedicated accept/decline
step instead, reached by that link specifically (after signing in first, if
they weren't already). Accepting is always a deliberate, explicit action —
never automatic — because joining a household means seeing its data, and
that requires the invitee's active consent, not just an owner's say-so.

---

## 2026-09-06 — Responsive web now, PWA installability deferred to Phase 6

**Decision:** all UI is built responsively (Tailwind breakpoints) from the
first component, so it reflows across any window size. Phone-specific UX
(touch targets, mobile nav) and installability as a PWA (manifest, icons,
home-screen install, optional offline access) are deferred to Phase 6, not
built now.

**Why deferring is free:** responsive layout is standard Tailwind usage, not
an extra step — there's no "desktop-only" shortcut being taken that would
need undoing later. PWA installability is additive metadata (a manifest
file + icons, optionally a service worker) that can be layered onto an
existing Next.js app at any point without touching `domain/`, `data/`, or
most of `ui/` — so there's no "wrapper" or special architecture to design in
now on the chance it's needed; nothing about Phase 1 (or any phase before 6)
changes as a result of eventually wanting a PWA.

**Alternatives considered:** designing a phone-specific "wrapper" or
adaptive-layout system now, in anticipation of phone use. Rejected — since
`ui/` is already isolated per module (see `ARCHITECTURE.md`), and PWA
support doesn't require restructuring that isolation, there's nothing
concrete to build ahead of time that would save work later.

---
