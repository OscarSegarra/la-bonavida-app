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
