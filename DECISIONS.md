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

## 2026-09-06 — Fixed: open redirect + auth-code hijack in the login flow

**Context:** caught by an automated security review of the Phase 1
implementation commit, not planning — recorded here because it's a real
vulnerability with a real fix, not just a style note.

**What was wrong:** the magic-link sign-in action (`src/app/login/actions.ts`)
built the email's `emailRedirectTo` URL from an `origin` value taken
straight from a hidden form field. Since a Server Action is just a POST
endpoint, nothing stops a direct POST with `origin` set to an attacker's
domain — which would make Supabase send the real auth code to *their*
callback URL instead of ours, a genuine account-takeover vector. Separately,
both the login action and `/auth/callback` used a client-supplied `next`
query param directly in a redirect target with no validation — an open
redirect (`next=https://evil.com` or protocol-relative variants).

**Fix:**
- `origin` is never taken from client input anymore. A new server-only
  `SITE_URL` env var (set per environment: `.env.local` for local dev,
  Vercel env vars for preview/production) is the only source now.
- A shared `safeRedirectPath()` helper (`src/lib/safe-redirect.ts`) only
  accepts a `next` value that's a same-origin relative path (starts with
  a single `/`, not `//` or `/\`, no `://`) — anything else falls back to
  a known-safe default. Used in both the login action and the callback
  route, the only two places a `next` value ever becomes a redirect target.

**Why this matters beyond the fix itself:** this is exactly the class of
mistake "explain before doing" is meant to catch at the design stage, but
this one slipped through because it was implementation detail (how to pass
the browser's origin through a form) rather than a named architectural
decision — worth remembering that request-derived values feeding into
redirects or outbound URLs need the same scrutiny as anything else
user-controlled, even when they don't look like "user input" at first
glance.

---

## 2026-09-07 — Fixes from a full code review of the Phase 1 branch

**Context:** ran `/code-review` against the whole `develop..feature/
phase-1-auth-households` diff after the branch was otherwise complete.
Ten findings came back; each is addressed (or explicitly deferred) below.

**Fixed, real bugs:**
- **`submitAlias` had the same open-redirect gap** as the login action/
  callback route (see the entry above) — it built its own `next` value
  from form data without going through `safeRedirectPath()`. Missed the
  first time because it's a third, easy-to-overlook call site for the
  same pattern. Fixed identically.
- **`accept_household_invite` had a TOCTOU race**: two people accepting
  the same token near-simultaneously could both pass the lookup and
  "not already a member" checks before either `DELETE` ran, both
  inserting — granting one single-use link to two people. Fixed with
  `for update` on the initial lookup, so a concurrent second call blocks
  until the first commits, then correctly sees the token as already gone.
- **The invite rate-limit trigger had the identical race** — two
  concurrent inserts could each read a pre-insert count and both pass the
  cap check. Fixed with a `pg_advisory_xact_lock` per household and per
  person, serializing concurrent invite creation for the same key (a
  legitimate second invite just waits its turn, it isn't rejected). Also
  merged what were two sequential `COUNT` scans into one query, per a
  separate efficiency finding on the same function.
- **`household_invites.invited_by` was `on delete cascade`**, silently
  contradicting the documented invariant that a link "belongs to the
  household, not the inviter." Leaving a household never triggered this
  (leaving only touches `household_members`), but deleting the inviter's
  *profile* (not a Phase 1 feature yet, but the eventual account-deletion
  case already noted above) would have deleted their still-valid pending
  invites too. Changed to `on delete set null` (column now nullable) —
  the audit trail can be lost, the invite itself never is.
- **`profiles.alias`/`households.name` length limits were UI-only** —
  `domain/validation.ts` claimed "the database enforces these too," but
  only non-emptiness had a check constraint; the length caps (60/100
  chars) didn't, so calling the Supabase API directly (normal usage for
  this app's own client) could bypass them. Added the missing check
  constraints rather than weakening the comment to match the gap.
- **No error boundary existed anywhere in the app**, so the zero-owner
  guard firing from a plain settings-page button (or any other uncaught
  Server Action error) fell through to Next.js's generic crash page.
  Added `src/app/error.tsx`. Also proactively hid the doomed action in
  the common case: the Roster and settings-page "Leave household" control
  now check whether the current user is the household's sole owner and
  hide/disable accordingly, so the error boundary is a safety net, not
  the normal path.

**Simplified, not a bug:** the six actions in `domain/actions.ts` that
call a `data/` function and translate a thrown error into `{ error }`
repeated that `try`/`catch` shape verbatim. Extracted a small `attempt()`
helper. (Deliberately *not* applied to `submitSetMemberRole`/
`submitRemoveMember`/`submitLeaveHousehold` — those have no inline error
state to fill in, and the new `error.tsx` boundary already covers them.)

**Acknowledged, not changed:**
- **The `household_members.user_id` → `profiles(id)` FK repoint
  (`20260906130000_profiles.sql`) validates immediately on the existing
  table**, rather than using `not valid` + a separate `validate
  constraint` step. That's the right caution for a migration hitting a
  table that might already hold rows violating the new constraint — ours
  didn't (preprod was empty at that point, and prod will be created fresh
  and replay every migration from the same starting point), so this
  specific migration is fine as committed. Noted here as a **going-forward
  practice**: a future FK/constraint addition to a table that might
  already hold non-conforming production data should use `not valid` +
  `validate constraint` (or backfill first), not this migration's
  immediately-validating form. Not editing the already-applied migration
  itself — that's against this project's own convention (never edit an
  applied migration; add a new one instead).
- **`domain/actions.ts` (Server Actions) has no test coverage**, unlike
  `domain/validation.ts`. Clarified in `CLAUDE.md` rather than rushed:
  Server Actions are thin orchestration over `data/` plus redirects —
  testing them meaningfully needs a real-or-mocked Supabase client
  (integration-test shaped), not a plain unit test, so they now
  explicitly fall in the same "tested more sparingly for now" bucket as
  `data/` and UI, rather than silently under-delivering on the `domain/`
  testing rule as originally worded.

**Process note:** during this review, a background finder subagent made
an unrequested, uncommitted edit to `actions.ts` (applying the
`safeRedirectPath` fix itself instead of just reporting it) — this was
caught and reverted before the review's findings were finalized, but it
also silently undid a fix already made earlier in the session that hadn't
been committed yet. Re-applied and committed immediately once noticed.
Lesson: don't leave a real fix sitting uncommitted across a review pass.

---

## 2026-09-07 — Function-level documentation, retrofitted to everything built so far

**Decision:** every substantive function (real internal logic — business
rules, data access, orchestration, Server Actions, SQL functions/triggers)
gets a documented input, output, and one-line overview at its own
definition — JSDoc for TypeScript, a comment block + `comment on
function` for SQL. Applied retroactively to all of Phase 0 and Phase 1,
not just new work going forward.

**Why:** re-examining each function's actual behavior closely enough to
accurately describe its inputs/outputs is itself a bug-finding pass —
the user specifically wanted the retrofit for this reason, not just as
documentation hygiene.

**Alternatives considered:** a separate documentation file describing
functions elsewhere in the codebase — rejected, since it drifts out of
sync with the code the moment either changes without the other, and this
project already has DECISIONS.md/PLAN.md for the "why," not the "what
does this function take and return." Going-forward-only — rejected; the
bug-finding value only applies to code that's actually re-examined.

**Scope line:** trivial one-liners (simple type guards, tiny formatting
helpers) and presentational UI components with no real internal logic
are exempt — their signature/props and JSX already document input/output.

---

## 2026-09-08 — Fixed: `createHousehold` wasn't just non-atomic, it was broken

**Context:** documenting `createHousehold` surfaced what looked like a
minor atomicity gap (two separate inserts, not one transaction). Fixing
it properly turned up something much bigger: the household insert used
`insert ... returning` (via `.insert({name}).select("id, name")`), and
that never actually worked for a real user in the first place.

**What was actually wrong:** `households` has `force row level security`,
which means `insert ... returning` must also satisfy the table's SELECT
policy for the row being returned — Postgres applies SELECT policies to
`RETURNING` as if it were a separate query. `households_select` requires
`private.household_role(id) is not null`, i.e. an existing membership —
but a household that was *just* inserted has zero members yet, so nobody
(not even its about-to-be owner) satisfies that check. The result: the
whole `INSERT` was rejected with an RLS violation, for every real
authenticated caller, every time. Confirmed empirically against preprod
before writing any fix — this was not a theoretical concern.

**Fix:** `create_household(_name text)`, a `SECURITY DEFINER` SQL
function that does both inserts (household, then owner membership) in one
transaction. `SECURITY DEFINER` isn't just for atomicity here — it's what
lets the function's own internal `RETURNING` bypass the chicken-and-egg
SELECT-policy problem, the same way `accept_household_invite` and
`get_household_invite` already bypass RLS for their own narrow reasons.
Safe for the same reason those are: no dynamic SQL, and the owner's
`user_id` always comes from `auth.uid()` internally, never a
client-supplied value.

**A second, smaller mistake caught along the way:** the first attempt
revoked `EXECUTE` from `anon` specifically (matching the pattern used for
the invite functions), but the security advisor still flagged `anon` as
able to call it. Unlike tables (where Supabase grants `anon`/
`authenticated` directly), a newly created *function* additionally gets
`EXECUTE` granted to the `PUBLIC` pseudo-role by plain Postgres default —
`anon` inherits through `PUBLIC` regardless of any revoke aimed at `anon`
alone. Confirmed via `information_schema.role_routine_grants`: this
function had a `PUBLIC` grant row and no separate `anon` row at all, so
revoking from `anon` was a silent no-op. Revoking from `public` (the
role) fixed it. Worth remembering as the inverse of the earlier
anon-vs-PUBLIC lesson from Phase 1's first invite migration.

**Also caught, and worth remembering as a testing-methodology note:** an
early manual verification attempt put a `create or replace function`
statement in the *same* `execute_sql` call as a later `rollback`, which
undid the redefinition along with the test data — the tool runs each
call as one transaction regardless of an explicit inner `begin`, so a
schema change meant to persist must never share a call with a `rollback`
used for test cleanup.

**Added 4 pgTAP assertions** (happy path creates both rows correctly; a
user with no profile fails on the FK as expected *and* leaves no orphaned
household behind) — re-verified the full suite (25/25) against preprod
before committing.

---

## 2026-09-11 — Phase 2+ reorder: Ingredients before Recipes, new Fridge
phase added after Shopping Lists

**Context:** starting Phase 2 planning. The original `PLAN.md` had Recipes
as Phase 2 and Ingredients as Phase 3, but a recipe's "attach ingredients +
quantities" bullet has nothing to attach to until the ingredient catalog
exists. Separately, a fridge/pantry inventory feature (not in the original
plan at all) was identified as needed, referencing ingredients and
interacting with shopping-list generation.

**Decision:**
1. Swap Phase 2 and 3: **Ingredients** now precedes **Recipes**. The real
   dependency chain is `households → ingredients → recipes → meal plans →
   shopping lists`; each phase's data model references the one before it,
   and shopping-list aggregation ("2 recipes need onions → one line item")
   only works if recipes reference the same ingredient row rather than a
   free-text name.
2. Add a new **Phase 6 — Fridge/pantry**, placed after Shopping Lists
   (Phase 5). It references the ingredient catalog and upgrades
   shopping-list generation to subtract on-hand stock ("need 2 onions,
   have 1, buy 1").

**Alternatives considered:**
- *Merge Ingredients+Recipes into one phase* — resolves the dependency,
  but doubles the PR/review size for a one-directional dependency that
  reordering already fixes for free.
- *Free-text ingredients in Recipes now, migrate to a catalog later* —
  ships Recipes "first," but breaks shopping-list aggregation and forces
  a real data migration later instead of building in the right order now.
- *Fridge phase placed right after Ingredients (Phase 3), before Recipes*
  — architecturally valid (fridge only depends on Ingredients, not
  Recipes/Meal Plans), but delays the core recipe → meal-plan loop the
  app is fundamentally about, for a feature whose main value (fridge-aware
  shopping lists) isn't usable until Shopping Lists exists anyway.
- *Fridge phase placed before Shopping Lists* — would let Shopping Lists
  ship fridge-aware from day one, but the user chose to ship the full
  simple planning loop (recipes → meal plans → basic shopping lists) end
  to end first, then layer Fridge on as an explicit enhancement pass over
  shopping-list generation. Accepted: one extra rework pass on shopping-
  list generation, in exchange for a working core loop sooner.

**Why:** matches how Phase 0/1 already built referenced entities before
the entities that reference them (e.g. `profiles` before
`household_invites`), and keeps each phase small and independently
reviewable rather than growing a phase to route around a dependency that
reordering resolves for free.

---

## 2026-09-11 — Ingredient catalog: global, not household-scoped

**Context:** Phase 2 planning. Every other table so far is scoped to
`household_id` and RLS-protected — a strict, enforced invariant (see
"Data & security" in `CLAUDE.md`). The question was whether ingredients
should follow that same pattern, or be shared reference data.

**Decision:** the ingredient catalog is **global** — one table, shared
across all households, not scoped to `household_id`. This is a deliberate
exception to the household-scoping rule, not an oversight; `CLAUDE.md`
has been updated to say so explicitly.

**Alternatives considered:**
- *Household-scoped* (this session's initial recommendation) — matches
  the existing invariant exactly, zero new access-control design needed.
  Rejected by the user in favor of avoiding duplicate typing across
  households ("onion" is the same concept regardless of who's cooking) —
  the app is expected to eventually serve many unrelated households
  (public, monetized), where that duplication and search fragmentation
  would compound.
- *Hybrid: global curated list + household custom additions* — most
  flexible, but doubles the Phase 2 data model (two ingredient sources to
  merge in recipe search) for no demonstrated need yet. Deferred as
  speculative.

**Write-access design** (the real cost of going global — a global table
needs an answer to "who can write to shared data everyone reads"):
- **Insert:** any authenticated user; a case-insensitive unique constraint
  on name blocks exact duplicates (near-duplicates like "onion" vs
  "yellow onion" are an accepted MVP gap, not solved now).
- **Update/delete:** only by the original creator (`created_by`), and
  only while the row is unreferenced by any recipe or fridge row —
  self-correct-your-own-typo, but no household can edit or delete another
  household's entry, or one already relied on elsewhere. This was
  revised mid-design from an initial "no edit/delete at all" — see the
  growth-trajectory note below for why.
- **Moderation** (flagging/removing bad public entries) is explicitly out
  of scope for beta.

**Why the write-access design isn't simpler:** the user set an explicit
project-wide assumption in this session — the app starts in beta with a
small number of trusted households, but is expected to eventually go
public and be monetized. "Any authenticated user can insert, nobody can
ever edit or delete" is a reasonable shortcut for a handful of trusted
people, but at public scale it's an abuse vector with no recourse: junk
or offensive entries would be visible to every household, forever, once
strangers can sign up. The "self-correct if unused" rule costs a few
extra lines now and avoids a re-architecture later — the general
principle to apply going forward for any decision that opens a shared
resource to user input. Full moderation tooling is still deferred (no
demonstrated need at beta scale) and tracked in `PLAN.md`'s
pre-public-launch checklist.

**Superseded minutes later, same session — see the next entry:** the
user proposed removing user writes entirely instead of mitigating them,
which turned out to be the better answer.

---

## 2026-09-11 — Ingredient catalog write-access: admin-curated, not
user-writable at all (supersedes previous entry's write-access design)

**Context:** immediately after deciding the catalog would be global with
an open-insert / self-correct-if-unused write policy, the user asked why
allow user writes at all, given the ingredient space — while large — is
genuinely finite, and an admin could maintain it directly instead.

**Decision:** the catalog is **read-only for regular users**. No insert,
update, or delete policy exists for authenticated users at all — under
Postgres RLS, the *absence* of a policy already means default-deny, so
this is less code than the previous design, not more. New ingredients are
added by the project owner directly via Supabase Studio (which uses the
service role and bypasses RLS) — no in-app admin role, flag, or UI is
introduced for this; that machinery isn't justified while the "admin" is
also the person with direct database access.

**Alternatives considered:** the open-insert / self-correct-if-unused
design from the previous entry — rejected because it still carried a
residual abuse/duplicate surface (near-duplicate entries like "onion" vs
"yellow onion" were an accepted gap, not solved) that admin-curation
removes entirely rather than mitigates, for less implementation cost.

**Why:** ranks better than the previous design on this project's own
priority order (security, then simplicity) — no user-write path means no
abuse vector to design around at all, and the RLS policy is simpler (read
policy only) rather than needing insert/update/delete logic. The
trade-off is a new bottleneck — households can't add their own missing
ingredients — accepted for now because the project owner *is* the only
real user during beta; tracked in `PLAN.md`'s pre-public-launch checklist
as "needs an ingredient request/suggestion flow" once that stops being
true.

**New requirement this creates:** the catalog needs a real seed list
before beta use, not an empty table — an admin-curated catalog that
starts empty blocks the very first recipe anyone tries to build. Seeding
approach (hand-curated vs. importing an open dataset) is a Phase 2
implementation detail, not decided yet.

---

## 2026-09-11 — Phase 2 reference data: nutrition, food groups, units —
all normalized reference-table + value-table pairs

**Context:** Phase 2 planning continued past the catalog's own
write-access design into what data each ingredient actually carries:
full nutrition values, a food-group classification, and a unit system
recipes/shopping-lists/fridge can do quantity math against.

**Decision — nutrition:** store the full EU-standard nutrient set
(Regulation 1169/2011 Annex XIII: 7 mandatory macros, 5 voluntary
macros, ~13 vitamins, ~14 minerals — around 40 possible fields)
**normalized**: a seeded `nutrients` reference table (code, name, unit,
category) plus an `ingredient_nutrients` value table (ingredient_id,
nutrient_id, value_per_100g) holding only the values actually known per
ingredient, rather than one `ingredient_nutrition` row with ~40 mostly
-null columns.

**Alternatives considered (nutrition):** a wide table with one column
per nutrient — simpler to read a single ingredient's full label (no
join), but the user's stated access pattern is specifically "sum this
across a day's meals eaten," which the normalized shape handles better:
`group by nutrient_id, sum(value * quantity_factor)` computes a full
daily breakdown as one server-side aggregate, versus either 40 separate
`sum(...)` expressions in one wide-table query (rewritten every time a
nutrient is added) or summing 40 columns across rows in application
code. Checked the actual performance concern directly: a join/`= any()`
batch query is still one database round trip regardless of table shape
— the real N+1 problem is looping per item in application code, which
neither design does here. Postgres also stores `NULL` columns as ~1 bit
in a per-row null bitmap, not a full-width empty value, so "mostly-null
wide table" isn't the storage/scan penalty it intuitively sounds like;
the deciding factor was the aggregation workload fit, not storage. A
covering index (`ingredient_id` including `nutrient_id, value_per_100g`)
keeps the normalized version index-only-scan fast. This also matches how
real food-composition databases (USDA FoodData Central, the Spanish
BEDCA) model the same genuinely-sparse data.

**Decision — food groups:** each ingredient gets exactly one required
`food_group_id`, from a 13-group taxonomy taken directly from AESAN's
"Recomendaciones Dietéticas Saludables y Sostenibles" (Dec 2022, read in
full during this session): Hortalizas, Frutas, Patatas y otros
tubérculos, Cereales, Legumbres, Frutos secos, Pescado y marisco,
Huevos, Leche y lácteos, Carne, Aceite de oliva, Agua, and a catch-all
Alimentos y bebidas a limitar for the document's "reduce/avoid" items
(processed snacks, added salt, sugary drinks, saturated fats), which the
source doesn't give individual serving guidance the way the recommended
groups get. Chose this finer 13-group breakdown over the document's own
coarser "at a glance" 6-group summary (which bundles legumes/nuts/fish/
eggs/dairy/meat into one "Proteínas" bucket) because the finer groups
match the level the actual serving-frequency recommendations operate at
— useful if a future feature ever checks a meal plan against them. Each
group's recommendation text is captured as a note on the row now (cheap
while already reading the source; not consumed by anything yet).

**Decision — units:** a `units` reference table (code, `dimension` —
mass/volume/count, `to_base_factor` relative to one base unit per
dimension) instead of a full pairwise conversion table — converting
between two same-dimension units is arithmetic on their factors, no
`unit_conversions` table needed. `ingredient_allowed_units` (many-to
-many) restricts which units make sense per ingredient (e.g. eggs by
count only), with `default_unit` as the preselected one. Cross
-dimension conversion (volume → mass, e.g. cups of flour to grams)
needs a per-ingredient density value and is explicitly out of scope —
tracked for whenever it's actually needed, not designed speculatively
now. Phase 3 (Recipes) will enforce that a recipe's ingredient lines can
only use units the referenced ingredient allows, and can only reference
ingredients that exist in the catalog — noted here so it isn't
forgotten when that phase is built.

**Why all three share one pattern:** nutrition, food groups (via their
FK), and units all follow the same "reference table + join/value table,
not fixed columns" shape used for the ingredient catalog's write-access
design — consistent architecture across Phase 2, and, for nutrition and
units specifically, the same "adding a new one later is a data insert,
not a migration" property that mattered for the ingredient catalog's own
design.

---

## 2026-09-11 — Allergens & dietary restrictions: unified tag system,
built in Phase 2 (not deferred)

**Context:** allergens (real EU-regulated food safety data) and dietary
restrictions (vegetarian, vegan, and more later) were initially discussed
as separate, and initially proposed as deferred to a later phase like
substitutes/subtypes.

**Decision:** build a minimal version **now**, in Phase 2, and — at the
user's suggestion — model allergens and dietary restrictions as **one**
system rather than two: a `dietary_tags` reference table (`category`:
`allergen` or `diet`) seeded with the EU's 14 officially regulated
allergens (Reg. 1169/2011 Annex II: gluten cereals, crustaceans, eggs,
fish, peanuts, soybeans, milk, tree nuts, celery, mustard, sesame,
sulphites, lupin, molluscs) plus diet labels (vegetarian, vegan to
start), and one `ingredient_dietary_tags` many-to-many join table for
both. Every tag means the same thing structurally — "this ingredient
carries this tag" — whether it reads as "contains X" (allergens) or
"compatible with X" (diet); that distinction lives in each tag's own
name/description, not in the table structure. Tagged by the admin in
the same curation pass as nutrition/food groups — no new access-control
design, since ingredients are already admin-curated (see the global
-catalog entry above).

**Alternatives considered:**
- *Defer both to a later phase*, matching the substitutes/subtypes
  decision — rejected specifically for allergens/diet because, unlike
  substitutes/subtypes, this data isn't purely additive: retrofitting it
  later means a full re-tagging pass over every ingredient already in
  the catalog, instead of tagging once during the curation work already
  happening now. Also closer to a real safety concern (actual allergies)
  than a convenience feature, which this project's priority order
  (security first) weighs in favor of building now.
- *Two hardcoded booleans* (`is_vegetarian`, `is_vegan`) plus a separate
  `allergens`/`ingredient_allergens` pair — rejected once the user
  pointed out it doesn't scale: every new diet type (halal, keto,
  low-FODMAP, ...) would need a schema migration to add a column. The
  unified tag table makes that a data insert instead, and reuses one
  mechanism instead of two.

**Known gap, not solved now:** tags are applied positively with no
automatic inference — tagging an ingredient "vegan" doesn't
automatically also tag it "vegetarian" (a true subset relationship in
reality). The admin tags both explicitly for now; building inference
logic is a later correctness improvement, not a blocker.

---

## 2026-09-11 — Multi-language content: translation companion tables
(system-wide pattern, not just Phase 2)

**Context:** the user wants the app fully multi-language (Spanish,
Catalan, English to start, more later) — not just ingredient names, but
recipes, shopping lists, and every future module's user-facing content.
Decided now, early, specifically to avoid retrofitting translated
content onto tables that already exist in several modules by the time
it's addressed.

**Decision:** two separate mechanisms for two separate problems.
1. **App chrome** (button labels, navigation, static UI text) uses
   `next-intl` — built for the Server-Component-first App Router setup
   this project already uses (checked current setup docs via Context7
   before recommending). Supported locales are a small code-level config
   (`defineRouting`), not a database concern, since adding a UI language
   always requires someone to actually translate the app's text.
2. **User-facing content** (ingredient names first; recipe titles/
   instructions and other modules' text later) uses a **translation
   companion table per translatable table** — e.g. `ingredients` holds
   locale-independent fields, `ingredient_translations` (ingredient_id,
   locale, name) holds one row per language with a real foreign key
   (`on delete cascade`) back to its parent. A `locales` reference table
   backs every such table; Spanish is the required default, other
   locales are optional, and a missing translation falls back to the
   default at read time (`coalesce`, a query-time concern, not a schema
   one). Each companion table stays owned by its own module, consistent
   with the connector-pattern boundary rule.

**Alternatives considered:**
- *A column per locale* (`name_es`, `name_ca`, `name_en`) — rejected for
  the same reason nutrients and allergens weren't modeled as fixed
  columns: adding a language later means an `ALTER TABLE` on every
  translatable table across every module, repeated every time a new
  language is added, instead of a one-time data insert.
- *One shared `translations` table for the whole app*
  (entity_type + entity_id + locale + field) — the most flexible option
  on paper, but rejected because it becomes a shared resource every
  module reaches into (conflicts with the connector-pattern module
  -boundary rule) and loses a real foreign key, since `entity_id` isn't
  actually tied to one specific parent table the way a per-table
  companion table's FK is.

**Why decided now instead of when Recipes (Phase 3) needs it:**
retrofitting this later would mean migrating whatever ad hoc `name`/
`title` columns Recipes (and every other module) had already shipped
with, instead of building every future translatable table against one
settled pattern from the start. This is now a standing convention in
`ARCHITECTURE.md` and `CLAUDE.md`, not a Phase-2-only decision — every
future module with translatable content reuses it without needing to
re-decide the shape.

---

## 2026-09-11 — Phase 2 delivery decisions (reviewing the plan for
buildability)

**Context:** a review pass over the Phase 2 requirements, specifically
looking for what would block or force guesswork during implementation.
The data model held up; the gaps were all about *delivery*. Full spec now
lives in `PHASE_2_PLAN.md`.

**Decisions:**
1. **Phase 2 ships a read-only browse/search/detail UI**, not just the
   data model. Alternative considered: data + tests only, with UI waiting
   for Phase 3 to consume it — leaner, but it leaves no way to visually
   sanity-check a few hundred hand-curated ingredients, and Phase 3 needs
   ingredient-picker components regardless.
2. **Seed data is ~150–250 hand-curated ingredients**, not a bulk import.
   Alternatives considered: BEDCA (Spanish, aligns with the AESAN food
   groups, but needs a licensing check before redistribution in a product
   intended to be monetized) and USDA FoodData Central (public domain, so
   no licensing risk, but English-only names and thousands of US-centric
   entries). Hand-curation gives a catalog that matches what the household
   actually cooks with; bulk import stays available later if it feels thin.
3. **Ingredient curation happens through a versioned dataset + importer
   script in the repo**, with Supabase Studio kept only for one-off fixes.
   This revisits the earlier "Studio is enough, no admin tooling needed"
   decision, which was made when an ingredient was two fields. After
   nutrition, food group, units, tags and translations, one ingredient is
   roughly 50 rows across five tables — hand-typing that in Studio is slow
   and error-prone enough to discourage keeping the catalog current. A
   typed `data/ingredients.ts` also turns a mistyped food-group or nutrient
   code into a compile error caught by CI, instead of a runtime failure.
   Building an in-app admin form was considered and rejected as premature
   while one person curates.
4. **Fixed vocabulary is translated via `next-intl` message keys, not
   database translation tables.** Food group, allergen, unit and nutrient
   display names live in the message catalogs; the database stores stable
   `code` values. The rule of thumb this establishes: *content users create
   → database translation tables; fixed vocabulary shipped with the app →
   message files.* Avoids four more tables and a join on every filter
   query. The alternative (companion translation tables for every
   reference table, fully consistent with the content pattern) was
   rejected as consistency for its own sake.
5. **Phase 1's 17 hardcoded-English `.tsx` files get retrofitted to
   `next-intl` as part of Phase 2**, rather than leaving a half-translated
   app until later.

**Schema corrections this review caught**, both from drafting against the
real codebase rather than from memory:
- Primary keys are `bigint generated always as identity`, matching
  `households`/`household_members`. An earlier sketch in conversation used
  `uuid`, which only appears on `profiles` because it mirrors
  `auth.users.id`.
- `ingredients.default_unit_id` was dropped in favour of an `is_default`
  flag on `ingredient_allowed_units` (with a partial unique index). With a
  column on `ingredients`, "the default unit must also be an allowed unit"
  needs a trigger to enforce; moving the flag into the join table makes
  that violation structurally impossible instead. Strictly less machinery.
- `ingredients.created_by` was dropped — a leftover from when users could
  insert ingredients. Under admin curation every row is written by the
  service role, so the column would always be null.
- Added `ingredients.nutrition_basis` (`per_100g` / `per_100ml`). EU labels
  declare per 100 g for solids and per 100 ml for liquids; without an
  explicit basis the two would be silently mixed in the same column.
- Added `ingredients.code` (stable slug). Since names are now per-locale
  rows, there was no natural key for the seed importer to upsert against.

**Risk flagged, not yet resolved:** this project runs Next.js 16, where
middleware is `src/proxy.ts` exporting `proxy()` — and that file already
owns Supabase's session-refresh response. `next-intl`'s documented setup
assumes `middleware.ts` and wants to own the response too. Composing them
is the one genuine unknown in Phase 2 and is scheduled as a spike before
the rest of the i18n work. Also carried forward: the `db-tests` CI job has
still never actually executed (flagged in Phase 1), and Phase 2 adds ~30
pgTAP assertions that depend on it.

---

## 2026-09-11 — Ingredient subtypes: variants curated now, the
*relationship* between them deferred (reconsidered on request)

**Context:** an explicit re-examination of whether subtypes (whole vs.
skimmed vs. lactose-free milk) should enter the Phase 2 schema rather
than being deferred alongside substitutes.

**Clarification the review produced:** subtypes were never actually
blocked. Because each variant has genuinely different nutrition, each is
its own ingredient row under the existing schema — nothing needed adding
to curate them. The only real question was whether to add an explicit
*relationship* linking variants.

**Decision:** curate variants as ordinary separate ingredients in Phase 2;
defer the linking structure. Enforce a shared-prefix naming convention in
the seed data ("Leche entera", "Leche desnatada", ...) so the grouping
stays mechanically reconstructible later — see `PHASE_2_PLAN.md` §6.

**Alternatives considered:**
- *A self-referential `parent_ingredient_id`* — the cheapest schema change
  (one nullable FK), but it forces answering "is the parent itself a
  usable ingredient?" now. If yes, the parent needs invented average
  nutrition values and Phase 3/5/6 immediately face "recipe wants Leche,
  fridge holds Leche desnatada — does that satisfy it?", which *is* the
  deliberately-deferred substitute semantics. If no, it needs an
  `is_abstract` flag plus nullable nutrition/units, punching holes in the
  `not null` constraints just tightened in this phase.
- *A separate `ingredient_groups` grouping table* — dodges both problems
  cleanly (no abstract ingredient row at all), but because group names are
  open-ended content rather than fixed vocabulary, this project's own i18n
  rule makes it two tables (`ingredient_groups` +
  `ingredient_group_translations`) for what is currently only a
  browse-list nicety at ~200 ingredients.

**Why the reasoning that justified building allergens now does *not*
transfer here** — worth recording, since the two cases look superficially
alike: allergens earned "build it now" because the data is genuine
per-ingredient research (does this contain sulphites?) that's expensive to
reconstruct in a second pass over the catalog. Subtype grouping is almost
entirely derivable from the ingredient names themselves, so a later pass
is cheap. The "retrofitting means re-curating everything" argument is real
in one case and not the other; applying it by analogy would have been
wrong.

**Why deferring is the safer direction here specifically:** designing a
relationship before the feature that consumes it invites designing it
wrong. Substitutes and subtypes turn out to be the same underlying
question — "what may stand in for what" — so they should be designed
together, against real behaviour, on top of variant data that by then
already exists.

---

## 2026-09-11 — Seed importer must be atomic per ingredient (Phase 1's
orphaned-row bug, caught recurring in the Phase 2 plan)

**Context:** tracing the knowledge graph surfaced that the Phase 2 testing
plan *cites* the `createHousehold` RLS/atomicity bug but contains no
assertion covering its Phase 2 equivalent. Checking the plan against
`phase1_invariants.sql` confirmed the gap was real.

**The recurrence:** Phase 1's bug was a parent row (`households`) written
separately from the child row that gives it meaning (`household_members`),
where a failure in between left an orphan. Phase 2's seed importer had
exactly that shape — an `ingredients` row plus four companion tables,
described as "upsert the parent, then replace the companion rows", with no
transaction specified. An `ingredients` row without its default-locale
translation is an ingredient with no name in any language.

**Decision:**
1. `scripts/seed-ingredients.ts` writes each ingredient's parent row and
   all companion rows **in one transaction** — all or nothing.
2. Two pgTAP assertions added (~30 → ~32): a full write produces every
   companion row, and a *failed* write leaves no orphaned `ingredients`
   row behind — the direct twin of `phase1_invariants.sql:L85`.

**Why validation wasn't already enough:** the plan already required the
script to validate before writing, and that reads like sufficient safety
but isn't. Validation guards against bad *input*; atomicity guards against
failure *during* the write. Phase 1 established that distinction the
expensive way and the plan still lost it.

**Why the re-seed path is worse than Phase 1's was:** "replace the
companion rows" means delete-then-insert. Phase 1's failure mode could
only fail to *create* data; this one can *destroy* existing good data,
leaving a previously-named ingredient nameless on a re-run — and re-running
the seed is supposed to be the safe operation.

**Worth remembering as a process note:** this session argued the Phase 1
lesson, logged it in this file, and cited it in the Phase 2 test plan — and
still wrote a seed process that repeated the shape. Citing a lesson is not
the same as applying it. The gap was found by tracing the graph's own
`testing plan → createHousehold bug` edge and asking whether the plan
actually covered what it referenced, which is a cheap check worth repeating
whenever a plan cites a past incident.

---

## 2026-09-11 — Ingredient seasonality: region × month rows, one seeded
region, and why it is not modelled as tags

**Context:** seasonality was added to Phase 2 scope — which ingredients are
in season, when — with the requirement that it vary by region, for a
possible future "prioritise seasonal ingredients and recipes" feature.

**Decision:** two new tables. `regions` (shared platform reference data,
alongside `locales` and `units`) and `ingredient_seasonality
(ingredient_id, region_id, month)`, one row per in-season month. Seeded
with exactly one region, `es`. Region display names via `next-intl`
message keys, consistent with the other fixed vocabularies.

**Why not the `dietary_tags` pattern** (the question that started this):
that pattern is boolean membership — "this ingredient carries this tag" —
which works for allergens and diets because they are binary, context-free
and few per ingredient. Seasonality is none of those: it is a time range,
it is region-dependent, and it is therefore a three-way relationship
(ingredient × region × month). Forcing it into tags would mean labels like
`seasonal_spain_june`, i.e. 12 months × N regions of flat strings, turning
"what's in season now" into string parsing. Same anti-pattern as modelling
the ~40 nutrients as boolean columns or tags.

**Why one row per month rather than a start/end range:** ranges read more
naturally but break on two common cases — wraparound (Spanish citrus runs
November–March, so `start_month > end_month` needs special-casing in every
query) and split seasons (two harvests in one year, which a single range
cannot express at all). A row per month makes both free and reduces the
lookup to one indexed equality. At most 12 rows per ingredient per region.

**Why the table is `regions` and not `countries`:** a seasonality region is
really *a market* — what reaches the shops, and when — which is climate
plus local agriculture plus trade. A country is a good proxy for compact,
market-integrated countries (and is how essentially every published
seasonal calendar is organised), and works better than raw climate would
predict because national distribution smooths internal variation: a shopper
in Bilbao buys Almería tomatoes. But it breaks for continental-scale
countries — US calendars are published per state, and Brazil, China, India,
Australia, Argentina, Chile and Canada have the same problem. Keeping the
table granularity-agnostic means `es` today and `us_ca` or `es_canarias`
later are all just rows. Naming it `countries` would have baked in an
assumption known in advance to be wrong for some markets.

**A model proposed in this session and rejected, worth recording because
it was wrong in an instructive way:** the first proposal was ~9 global
*climate bands* (Mediterranean, Atlantic temperate, continental, tropical,
and their southern-hemisphere counterparts), on the reasoning that climate
is what physically drives growing seasons. The user rejected it: California
and Spain share a Mediterranean climate but grow different crops at
different scales, so a shared row would be confidently wrong for both.
The correction is that seasonality data encodes *market availability*, not
*growing conditions* — climate is only one input. The tell that should have
caught it earlier: every published seasonal calendar in the world is
organised nationally, which is evidence about the right unit, not an
accident of convenience. This also retracted a naming recommendation that
depended on the wrong model (`mediterranean_iberian` over `es`).

**Why one seeded region, and why that isn't the allergen case:** the test
used repeatedly this phase is "how expensive is this to reconstruct later".
For allergens the answer was "a full re-curation pass", so they were built
now. For regions it is "no more expensive than doing it now" — adding
Portugal later is new research either way, with no retrofit penalty, while
every speculative region multiplies curation immediately (~60 seasonal
ingredients × N regions) for regions with no users.

**Known limitation, recorded rather than solved:** absence of seasonality
rows is ambiguous. For `es`, no rows on flour means "not seasonal, available
year-round"; no rows on mango means "not grown here, imported year-round".
Both read as "no local season", which is correct for a
prioritise-what's-in-season feature. Distinguishing "never grown locally"
is a *local sourcing* feature and is deferred.

---

## 2026-09-11 — Households get a region (`households.region_id`), defaulting
to Spain, changeable by any owner

**Context:** seasonality is stored per region, but nothing in the app could
say *which* region a household is in — leaving `ingredient_seasonality`
keyed by something unaddressable. This was initially deferred to a later
phase and has been pulled into Phase 2.

**Decision:** `households.region_id`, `not null`, referencing
`public.regions`. Defaults to Spain at creation; any owner can change it
afterwards from the household settings page.

**Why now rather than later:** the deferral test used throughout this phase
is "how expensive is this to reconstruct later", and by that test alone
this is cheap to defer (a nullable column, backfilled to `es`, no research
required). Two things outweighed it: without it the Phase 2 seasonality
data has no consumer that can even name a region, and the household
settings page is already being modified this phase for the i18n retrofit —
so the UI lands on a screen already being touched rather than opening new
surface later.

**Notable: this is the only Phase 2 change to an existing Phase 0/1
table.** Everything else in the phase is new tables, which is why it needs
more care than the rest.

**Three-step migration, not one statement:** `add column ... not null` on a
table with existing rows requires those rows populated first, and a column
`default` cannot be a subquery in Postgres. So: add nullable → backfill
from `regions.is_default` → set `not null`. The default region is resolved
at insert time instead of being declared on the column.

**`create_household()` had to be updated** — it inserted `households
(name)` only and would have violated the new `not null`. Deliberately
*without* adding a `_region_id` parameter: the requirement is "default at
creation, change later in settings", so creation never chooses, and holding
the signature at `create_household(_name text)` means the four existing
Phase 1 pgTAP assertions calling it keep passing unmodified. Its
`SECURITY DEFINER`, its `revoke ... from public`, and its comment block are
all load-bearing (see the 2026-09-08 entries) and must survive the
`create or replace` intact.

**Default resolved via `regions.is_default`, not a hardcoded `code = 'es'`**
— keeps the country out of the function body and mirrors how
`locales.is_default` already works. `regions` gains the flag plus a partial
unique index, the same shape as `locales`.

**No new RLS policy was needed, which is worth recording explicitly.** The
existing `households_update` policy is already owner-only for the whole
row, so "any owner may change the region, members may not" is satisfied by
what Phase 1 already built. Five pgTAP assertions were added anyway
(default applied on creation; owner can update; member cannot; non-member
cannot; FK and not-null enforced) — because the behaviour here is
*inherited* rather than stated, and inherited behaviour is the kind that
breaks silently when someone later edits the policy for an unrelated
reason.

---

## 2026-09-11 — Phase 2 plan review: the seed importer becomes an RPC, and
cross-dimension conversion is un-deferred

**Context:** a defect review of `PHASE_2_PLAN.md` before any of it is
built. Fourteen issues were found; two were design reversals rather than
typos and are recorded here.

### Reversal 1 — atomicity via a Postgres function, because the previous
instruction was unbuildable

The plan required each ingredient to be written "in a single transaction"
while also specifying the service-role Supabase client for the seed script.
Those are incompatible: supabase-js talks to PostgREST, where **every call
is its own transaction**, so five table writes cannot be wrapped in one. The
requirement could not have been implemented as written — it would have been
discovered at build time, probably by shipping a non-atomic importer that
looked like it satisfied the plan.

**Decision:** `public.upsert_ingredient(payload jsonb)`, a Postgres
function shipped as a migration and called once per ingredient via
`supabase.rpc()`. A function body is a single transaction, so a failure
anywhere in it rolls back the whole ingredient with no client-side
transaction management.

**Alternative considered:** connecting directly to Postgres with
`pg`/`postgres.js` and a connection string, where real transactions are
available. Rejected — it adds a second database access path and a second
credential to the project for the sake of one script, where the RPC reuses
what already exists.

**Note it is `SECURITY INVOKER`, deliberately unlike `create_household`.**
It is only ever called by the seed script under the service role, which
already bypasses RLS, so it needs no elevation — and `EXECUTE` is revoked
from `public`/`anon`/`authenticated`, with a pgTAP assertion guarding that.
Granting it to `authenticated` would hand every signed-in user a write path
into the admin-curated catalog, defeating the phase's entire RLS model.

**This is the third time the same lesson has surfaced in one session:**
`create_household` (Phase 1, shipped broken), the seed importer's
delete-then-insert path (caught by tracing the graph), and now the
transaction mechanism itself. A multi-row write that must be all-or-nothing
belongs in one Postgres function, not in a sequence of client calls.

### Reversal 2 — cross-dimension unit conversion is back in scope, approximately

The plan previously ruled cross-dimension conversion (1 tbsp flour → grams)
out of scope *because* it needs per-ingredient density, and separately had
no way to compute nutrition for count-based ingredients (nutrition is per
100 g, but a recipe says "2 eggs").

**Decision:** two nullable columns on `ingredients` —
`density_g_per_ml` (volume ↔ mass) and `grams_per_unit` (count → mass).

**Why the reversal:** the user's criterion was that perfect precision
matters less than usability. Once an approximate egg weight is acceptable,
an approximate density is no different in kind — 1 ml of olive oil ≈ 0.92 g
is exactly the same sort of fudge as 1 egg ≈ 60 g. Accepting both is
strictly more useful than accepting neither.

**It also deleted a constraint rather than adding one.** The review's
original proposal was a hard rule that all allowed units of an ingredient
must share a dimension — which would have meant flour *cannot* be measured
in tablespoons. With a density, that restriction is unnecessary: the
cross-dimension case is computable, so it can simply be allowed. Preferring
the option that removes a restriction over the one that adds a rule is the
better outcome on the project's simplicity priority as well as on
usability.

**Recorded limits:** both values are deliberate approximations and must
never be surfaced as exact nutrition (a large egg is not a medium egg). The
conversion *logic* is still not written in Phase 2 — nothing computes
quantities yet. What changed is only that the data it will need is gathered
during curation instead of demanding a second research pass over the
catalog later, which is the same reasoning that put allergens in this phase.

### Also fixed in the same pass (defects, not reversals)

A missing `is_default` region would have made `create_household()` fail for
every user — a total outage of a Phase 1 feature caused by absent Phase 2
reference data, since the partial unique index guarantees *at most* one
default and never *at least* one. Now asserted, with the migration ordering
(create → seed → alter) made explicit because the backfill silently writes
NULLs if `regions` is not yet seeded. Alongside: `nutrition_basis` was
undefined for count-based ingredients; `ingredient_seasonality` was missing
from the companion-table lists; `getIngredient` now keys on `code` rather
than `id` so detail URLs survive a re-seed; `listUnits()` was removed from
the ingredients module because it contradicted the shared-reference-data
rule; and a covering index was dropped as unearned optimisation on a
few-thousand-row table.

---

## 2026-09-12 — Phase 2 as built: what the plan got right, and what only
building it revealed

**Context:** Phase 2 shipped across five PRs. The plan held up well enough
that this entry is mostly about the gap between planning and building,
which is the part worth keeping.

**The plan's own review paid for itself.** The pre-build defect pass
caught that the seed importer's headline requirement — "each ingredient
written in a single transaction" — was *unimplementable* as specified,
because PostgREST gives every call its own transaction. Had that reached
the build, the likely outcome was a non-atomic importer that looked like
it satisfied the plan. Reviewing a plan for buildability, not just
soundness, is cheaper than discovering it mid-slice.

**Three bugs were found by running things rather than reading them**, and
all three were invisible to typecheck, lint and unit tests:
- An ambiguous column reference in `upsert_ingredient`'s units join,
  caught on the function's very first real call.
- A missing duplicate-name check in the importer. The database enforces
  unique names per locale, so a collision would have surfaced part-way
  through a run, after earlier entries had already been written.
- `"1 ingredientes"` — no pluralisation — visible only once real data was
  rendered. Fixed with ICU plurals.

This is the argument for the browser-verification step in the testing
bar, restated with evidence: every automated gate was green while the
list was rendering incorrect Spanish.

**A fourth, in the tests themselves:** six pgTAP assertions used the
two-argument `throws_ok(sql, text)`, which treats its second argument as
the *expected error message* rather than a description — so they compared
raised errors against their own prose. Worth remembering, because such a
test fails loudly here but could just as easily pass for the wrong reason
elsewhere.

**The same lesson surfaced a third time.** A multi-row write that must be
all-or-nothing belongs in one Postgres function, not a sequence of client
calls: `create_household` (Phase 1, shipped broken), the seed importer's
delete-then-insert path (caught by tracing the knowledge graph), and the
transaction mechanism itself. Three different routes to one conclusion.

**Two decisions that are worth re-reading when Phase 3 starts:**
- `upsert_ingredient` is `SECURITY INVOKER`, deliberately unlike
  `create_household`. Only the seed script calls it, under a service role
  that already bypasses RLS, so elevation would add nothing but blast
  radius. The distinction matters: "it's a SECURITY DEFINER project" is
  not a convention, it is a per-function judgement.
- The region form performs no permission check of its own, because the
  owner-only `households_update` policy already refuses it. Restating an
  RLS rule in application code creates a second, weaker copy — one that
  can be bypassed — and two places to keep in sync.

**Known limitations recorded rather than resolved:** the seed dataset is
62 ingredients against a 150–250 target; only a representative subset is
loaded into preprod; and the magic-link flow is still unverified
end-to-end, since this environment has no email inbox. See `PLAN.md`'s
Phase 2 status block.

---

## 2026-09-12 — The `main` cutover stays deferred, now for a tested reason
rather than an assumed one

**Context:** with Phase 2 merged to `develop`, the natural next step
looked like merging `develop` into `main`. `main` was 33 commits behind,
still sitting at the Phase 0 scaffold.

**What stopped it:** `main` deploys to Vercel Production, and Production
has no database. `la-bonavida-prod` does not exist, so the deploy would
either 500 on every route (env vars unset — `proxy.ts` survives that, but
every page calls `createClient()`, which does not) or, if pointed at
preprod, would have production reading and writing the development
database. The second is worse than the first.

**Creating the prod project was attempted and refused**, which turns a
previously-assumed constraint into a verified one:

> The following organization members have reached their maximum limits
> for the number of active free projects […] OscarSegarra (2 project
> limit).

The two active slots are `la-bonavida-preprod` and `La BonaVida APP` —
the old backend still serving real users. `labonavida-staging` is already
paused, so it occupies no slot and deleting it would free nothing. Cost
was quoted at $0/month, so this is a capacity limit, not a pricing one.

**Decision:** hold the `main` merge; keep shipping on `develop`.

**Alternatives considered:**
- *Retire or pause the old live app* to free a slot — rejected. It frees
  the slot immediately but breaks an app people are using, and the
  replacement is at Phase 2 of 7: no recipes, meal plans or shopping
  lists. The old app cannot be retired until the new one can do its job.
- *Upgrade to Pro* — rejected for now. Real recurring cost for a
  production environment with no users.
- *Merge anyway and accept a broken Production deploy* — defensible,
  since nothing points at that URL yet, but it buys only the appearance
  of currency on `main` and costs a deploy that fails in public.

**Why this is not drift:** the original deferral said to revisit "when
ready to actually launch", and finishing Phase 2 does not make the app
ready to launch. The reasoning that deferred it is unchanged; only its
evidence improved. `CLAUDE.md` now says explicitly that `main` is stale
on purpose, so a future session doesn't "tidy it up".

**One thing that will need a person either way:** the Vercel project
config is not readable from this session (403), so the Production
environment variables have to be set by hand whenever the cutover
happens, regardless of which path is taken to a prod database.

---
