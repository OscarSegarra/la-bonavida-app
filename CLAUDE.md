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

New schema changes are **migrations**, checked into
`supabase/migrations/*.sql` and reviewed like any other code change before
being applied — this is how real teams evolve a shared database without
each other's changes clobbering one another or drifting environments out of
sync.

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

## Testing expectations

New business logic (anything in a module's `domain/`) should get a unit
test. Database access (`data/`) and UI are tested more sparingly for now —
revisit as the app grows past MVP.

## Email

No real transactional email yet. Supabase's built-in test email handles
local/preprod auth flows. A clearly marked seam exists for swapping in
Resend via Supabase's custom SMTP setting once a domain is available.
Proton is Oscar's personal/admin inbox — it will never send app email.

## Known deferred items (see `DECISIONS.md` for full context)

- `la-bonavida-prod` Supabase project: not created yet (free-tier project
  cap — see `DECISIONS.md`). Create it when ready to actually launch.
- Old GitHub repo (`OscarSegarra/Food-scheduler`) and old Vercel
  project/Supabase projects (`La BonaVida APP`, `labonavida-staging`) are
  from an earlier attempt at this project — left running/paused
  intentionally, not to be touched without Oscar's explicit go-ahead.
- Extracting `shopping-lists` into a real separately-deployed service is a
  planned future learning exercise, not part of the MVP.
