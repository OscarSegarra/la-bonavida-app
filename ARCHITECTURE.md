# Architecture

La BonaVida is one Next.js application ("a monolith") that is internally
organized into independent **modules** — this is called a **modular
monolith**. It's how Shopify's and GitHub's core applications are built:
one deployable app, but with strict internal walls between domains, so a
module can be changed without risking breakage elsewhere.

## Modules

| Module | Owns |
|---|---|
| `households` | Households, household membership, roles (owner/member) |
| `recipes` | Recipe definitions |
| `ingredients` | Ingredient catalog |
| `meal-plans` | Weekly/date-based meal plans |
| `shopping-lists` | Shopping lists and their items |

Each lives at `src/modules/<name>/`.

## The connector pattern

Modules talk to each other through **plain function calls**, not network
requests and not events. Each module exposes exactly one file —
`src/modules/<name>/index.ts` — and that is the *only* file anyone outside
the module is allowed to import. Everything else inside the module
(`domain/`, `data/`, `ui/`) is private.

**Why not events (pub/sub)?** Events decouple modules further, but make
control flow indirect — to know what happens when a recipe is deleted, you'd
have to go find every subscriber instead of reading one function. They also
complicate keeping a database transaction consistent across an action (e.g.
"create a meal plan and reserve ingredients" needs to be atomic). Events pay
off once many independent modules must react to one action without knowing
about each other — we're not there yet.

**Why not microservices (real network APIs)?** Splitting modules into
separately-deployed services buys true independent deployability, at the
cost of network calls that can fail, no more shared database transactions
(cross-service consistency needs a "saga" pattern), service-to-service auth,
API versioning, and a CI/CD pipeline per service. That's real
distributed-systems complexity that isn't justified for an app used by one
household.

**Decision:** build the modular monolith now, and once the app is stable,
deliberately extract **one** module — `shopping-lists` — into a real
separate service as a hands-on exercise. See `DECISIONS.md` for the full
reasoning; this mirrors how most real companies actually migrate (monolith
first, extract only when a concrete need forces it).

## Enforcing the boundary automatically

Folder structure alone doesn't stop anyone (a future session included) from
accidentally reaching into `modules/recipes/data/*` from another module. So
the boundary is enforced by a lint rule
(`eslint-plugin-boundaries`, configured in `eslint.config.mjs`) that fails
the build if any file outside a module imports anything from it other than
its `index.ts`. This runs in CI on every pull request — the same technique
real modular monorepos (e.g. via Nx) use to stop architecture from eroding
silently over time.

## Inside each module: 3 layers

- `ui/` — presentation (React components, if the module renders anything
  directly)
- `domain/` — business logic, framework-agnostic
- `data/` — database queries (Supabase client calls)

Only `index.ts` at the module root is public; `ui/`, `domain/`, and `data/`
are implementation details the module is free to change without asking
permission from the rest of the app.

## Data model & security

Every table is scoped to a `household_id` and protected by **Row Level
Security (RLS)** — enforced by Postgres itself, not by application code
remembering to filter queries. A user can never read another household's
data, even via a raw query, because the database refuses the row before the
application ever sees it. See `supabase/migrations/` for the schema, and
`DECISIONS.md` for why RLS design choices were made the way they were.

**Deliberate exception:** shared reference data that isn't private to one
household — the global `ingredients` catalog (Phase 2) and everything that
hangs off it (nutrients, food groups, allergens/diet tags, units) — is not
`household_id`-scoped. It's read-only for regular users, writable only by
the project owner. See `CLAUDE.md` and `DECISIONS.md`; this must stay a
rare, explicitly-logged exception, not a pattern to reach for by default.

Security, then simplicity, then modularity, then efficiency — in that
priority order — wins whenever two goals conflict in this codebase.

## Internationalization

Two separate problems, solved two different ways:

**App chrome** (labels, navigation, error messages — text written in the
codebase) uses `next-intl`, which is built for the Server-Component-first
App Router setup this project already uses. Supported locales are a small
code-level config (`defineRouting({locales: [...], defaultLocale: 'es'})`);
middleware resolves the locale per request; translated strings live in
per-locale JSON message files. Adding a UI language always means someone
translates the app's text, so this list lives in code, not the database.

**Content people create in the app** (ingredient names first; recipe
titles/instructions, and other modules' text later) uses a **translation
companion table per translatable table**, not a column-per-locale and not
one shared cross-module table:

- The parent table (`ingredients`) holds only locale-independent fields.
- A `<table>_translations` table (`ingredient_translations`:
  ingredient_id, locale, name) holds one row per language, with a real
  foreign key back to its parent (`on delete cascade`) — owned by the
  same module as the parent table, consistent with the module-boundary
  rule above.
- A `locales` reference table backs every `_translations` table. One
  locale (Spanish) is required as the default; others are optional, and
  a missing translation falls back to the default at read time
  (`coalesce`d in the query, not a schema concern). `locales` itself
  isn't owned by any one feature module — it's shared platform reference
  data, like the migrations/CI conventions above it, so any module's
  `data/` layer can query it directly rather than routing through
  another module's connector for it.

**Why this shape and not the alternatives:** a column per locale
(`name_es`, `name_ca`, `name_en`) means an `ALTER TABLE` on every
translatable table every time a language is added — rejected for the same
reason the nutrients and allergen data below were normalized instead of
using fixed columns. One giant shared `translations` table for the whole
app (entity_type + entity_id + locale + field) is maximally flexible, but
it becomes a shared resource every module reaches into and loses a real
foreign key (entity_id points at a different table depending on
entity_type) — it directly conflicts with the connector-pattern rule
above. The per-table companion pattern gets the "add a language later is a
data insert, not a migration" benefit without either downside. See
`DECISIONS.md` for the worked example (`ingredient_translations`) and the
full alternatives considered.
