@AGENTS.md

# La BonaVida — working conventions

Household meal-planning, shopping-list, and (future) household-management
app. The user (Oscar) is building this to use daily and eventually share
with family. This is also deliberately a **learning project** — Oscar knows
basic coding but isn't an expert, and wants to come out of this
understanding both how real software gets built at a company and how to
code/design well himself.

## How to work with Oscar — every session, every meaningful decision

For every meaningful decision (architecture, security, workflow, tooling,
testing, anything non-trivial):

1. **Don't just pick an option and proceed.** Explain the realistic choices
   in plain language (what it means day-to-day, not jargon), say which
   you'd recommend and why, and wait for confirmation before building it.
2. **Connect the decision to real professional practice** — e.g. "in a real
   company this is usually done via X, because Y" — especially for anything
   he likely hasn't touched yet (pull requests, code review, database
   migrations, CI/CD, feature flags, semantic versioning, etc). Explain
   before doing, not after.
3. **Log every significant choice in `DECISIONS.md`** (an Architecture
   Decision Record / ADR) — what was decided, what alternatives were
   considered, and why, in plain language. This is both the project
   reference and Oscar's learning notes.
4. Keep this file up to date as conventions evolve, so every future session
   inherits them automatically without Oscar repeating himself.

## Growth trajectory

The app starts in beta with a small number of trusted households, but is
expected to eventually go public and be monetized. This doesn't change how
things are built now — still MVP-simple, still YAGNI — but it changes which
shortcuts are safe: a shortcut fine for a handful of trusted people (e.g.
"anyone can write here, no one can ever moderate it") can become a real
abuse or trust problem once strangers can sign up. Wherever a decision
opens a shared resource to user input, prefer the option that won't need
re-architecting later, even at the cost of a few extra lines now. See
`PLAN.md`'s pre-public-launch checklist and `DECISIONS.md` (global
ingredients catalog) for a worked example.

## Priority order when goals conflict

**Security, then simplicity, then modularity, then efficiency.** When two
goals conflict, resolve in that order.

## Architecture

See `ARCHITECTURE.md` for the full picture. Summary: a modular monolith —
one Next.js app, internally split into modules under `src/modules/*`
(`households`, `recipes`, `ingredients`, `meal-plans`, `shopping-lists`).
Modules talk to each other only through each module's `index.ts`
("connector") — never by reaching into another module's `domain/`, `data/`,
or `ui/`. This is enforced automatically by `eslint-plugin-boundaries`
(`eslint.config.mjs`), not just by convention — a boundary violation fails
lint and therefore fails CI.

Within a module, keep the 3-layer split: `ui/` (presentation), `domain/`
(business logic), `data/` (Supabase queries). Only `index.ts` is public.

## Data & security

Every table is scoped to `household_id` and protected by Row Level Security
— enforced by Postgres, never just by application-level filtering. A user
must never be able to read another household's data, even via a raw query.
See `supabase/migrations/` and `DECISIONS.md` for the RLS design (notably
the `private.household_role()` SECURITY DEFINER helper used to avoid
recursive policies).

**Deliberate exceptions — two so far, both logged.** The global
`ingredients` catalog (Phase 2) and the global `recipes` catalog
(Phase 3) are not `household_id`-scoped. Each is a global table whose
write-access policy replaces household RLS: authenticated users read, no
user writes at all, and the only write path is a `security definer`
function called by a seed script under the service role. "No user write
path" is what earns the exception — it removes the abuse surface rather
than mitigating it. This must stay rare and explicitly logged (see
`DECISIONS.md`), never a default: if you're adding a new table and
reaching for "global" instead of `household_id`-scoped, that's a decision
to discuss and log, not assume.

**Phase 3 also introduces a per-user scope.** A recipe may eventually be
owned by a person rather than a household (`owner_user_id`, null meaning
"the global catalog"), and other people see it by subscribing to that
person. Household-scoped remains the default for anything new.

New schema changes are **migrations**, checked into
`supabase/migrations/*.sql` and reviewed like any other code change before
being applied — this is how real teams evolve a shared database without
each other's changes clobbering one another or drifting environments out of
sync.

## Internationalization

The app is multi-language from Phase 2 onward (Spanish, Catalan, English
to start; more later). App chrome uses `next-intl`. User-facing *content*
(ingredient names, later recipe titles/instructions, etc.) uses a
**translation companion table per translatable table**
(`<table>_translations`, one row per locale, real FK back to its parent)
— never a column per locale, never one shared cross-module translations
table. See `ARCHITECTURE.md` ("Internationalization") for the full
pattern and why; every module with translatable content reuses it.

## Environments

Two fully separate Supabase projects and two Vercel environments — kept
separate so a mistake in an in-progress feature can never touch real data:

| Git branch | Supabase project | Vercel environment |
|---|---|---|
| `main` | `la-bonavida-prod` | Production |
| `develop` | `la-bonavida-preprod` | Preview |

Feature branches merge into `develop` via PR. `develop` merges into `main`
via PR only after manual verification on preprod. Branch protection is
enabled on both `main` and `develop`.

Local development points at **preprod**, never prod — see `.env.example`.

## CI

Every PR runs (GitHub Actions, `.github/workflows/ci.yml`), required to
pass before merge:
- **Type-check** (`pnpm run typecheck`) — catches type errors before
  runtime.
- **Lint** (`pnpm run lint`) — style + the module-boundary rule.
- **Unit tests** (`pnpm run test`) — catches logic regressions.

## Naming

- Supabase projects: `la-bonavida-preprod`, `la-bonavida-prod`.
- Modules: kebab-case folder names under `src/modules/`
  (e.g. `meal-plans`, `shopping-lists`).
- Migrations: `supabase/migrations/<YYYYMMDDHHMMSS>_<snake_case_name>.sql`.

## UI scope for now

All UI is built **responsively** from the start (Tailwind breakpoints —
`sm:`/`md:`/`lg:`) so layouts reflow across different window sizes; this is
standard practice, not extra work deferred to later. What *is* deferred to
Phase 6 (see `PLAN.md`) is phone-specific UX polish (touch-target sizing,
mobile navigation patterns) and installability as a PWA (home-screen icon,
manifest, offline access) — see `DECISIONS.md`. This all stays a
presentation-layer concern only — `domain/` and `data/` are already
framework-agnostic and must never encode any assumption about screen size
or viewport; only a module's `ui/` folder should need to change as phone
support is filled in later.

## Data fetching

Pages are **Server Components** by default — fetch data server-side during
render (`async function Page()` calling Supabase directly), not as a
Client Component fetching via `useEffect` after the page has already
loaded (that's a real extra round trip: download JS, run it, then start
fetching, for data that was already known and cheap to fetch server-side).
Mutations go through **Server Actions** (`'use server'` functions), called
from small Client Component buttons/forms — only the actually-interactive
pieces of a page need `'use client'`, not whole pages. This is a default
favoring fewer round trips, not an absolute rule — a specific future piece
that genuinely needs live client-side updates can still be a Client
Component. See `DECISIONS.md` ("Phase 1 efficiency pass") for the reasoning.

## Testing expectations

New business logic (pure functions in a module's `domain/`, e.g.
`domain/validation.ts`) should get a unit test. A module's Server Actions
(`domain/actions.ts`) are thin orchestration over `data/` calls plus
redirects — they fall in the same "tested more sparingly for now" bucket
as `data/` and UI, not the domain-logic bucket, since testing them
meaningfully means integration-testing against a real or mocked Supabase
client rather than a plain unit test. Revisit as the app grows past MVP.

## Function documentation

Every **substantive** function — real internal logic: business rules,
data access, orchestration, Server Actions, SQL functions/triggers — is
documented at its own definition, not in a separate file that can drift
out of sync with the code it describes:
- **TypeScript:** a JSDoc block directly above the function — a one-line
  overview, `@param` per input, `@returns` for the output.
- **SQL functions:** a comment block above `create function` in the
  migration, plus a `comment on function ...` statement, so the
  documentation is real, queryable Postgres metadata (visible via `\df+`
  or in Supabase Studio), not just a comment in a file.

**Exempt:** trivial one-liners (simple type guards, tiny formatting
helpers) and presentational UI components with no real internal logic —
their signature/props and JSX already say what goes in and what comes
out. See `DECISIONS.md` for why this applies retroactively to everything
already built, not just new work.

## Email

No real transactional email yet. Supabase's built-in test email handles
local/preprod auth flows. A clearly marked seam exists for swapping in
Resend via Supabase's custom SMTP setting once a domain is available.
Proton is Oscar's personal/admin inbox — it will never send app email.

## Known deferred items (see `DECISIONS.md` for full context)

- `la-bonavida-prod` Supabase project: not created yet (free-tier project
  cap — see `DECISIONS.md`). Create it when ready to actually launch.
- **`main` is deliberately stale.** It sits at the Phase 0 scaffold while
  `develop` carries everything built since. That is not neglect: merging
  to `main` deploys to Vercel Production, which has no database to talk
  to until `la-bonavida-prod` exists. Don't "tidy this up" by merging —
  the cutover is a launch decision, and every PR already gets a preview
  deployment against preprod, so nothing is blocked by waiting.
- Old GitHub repo (`OscarSegarra/Food-scheduler`) and old Vercel
  project/Supabase projects (`La BonaVida APP`, `labonavida-staging`) are
  from an earlier attempt at this project — left running/paused
  intentionally, not to be touched without Oscar's explicit go-ahead.
- Extracting `shopping-lists` into a real separately-deployed service is a
  planned future learning exercise, not part of the MVP.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
