# Phase 2 — Ingredients: build plan

The detailed, buildable spec for Phase 2. `PLAN.md` holds the roadmap-level
summary; `DECISIONS.md` holds *why* each choice was made. This file is the
*how*: schema, module layout, sequencing, and the testing bar to clear
before Phase 2 is considered done.

Everything here follows decisions already logged in `DECISIONS.md`
(2026-09-11 entries). If something here contradicts that file, that file
wins and this one is stale.

---

## 1. What Phase 2 ships

- The global, admin-curated ingredient catalog and all its reference data.
- A seed dataset of ~150–250 hand-curated ingredients.
- A read-only **browse / search / detail** UI for ingredients.
- `next-intl` wired up across the app (es / ca / en), including retrofitting
  the existing Phase 1 pages, which are currently hardcoded English.

**Not** in Phase 2: recipes, any write path for regular users, an in-app
admin UI, substitutes/subtypes, typo-tolerant search. See §9.

---

## 2. Schema

Twelve tables, all in `public`. Conventions follow Phase 0/1: `bigint generated
always as identity` primary keys (not `uuid` — `profiles` uses `uuid` only
because it mirrors `auth.users.id`), `timestamptz not null default now()`,
RLS enabled *and* forced, explanatory comment block above each object, and
`comment on ...` for anything with real logic.

### 2.1 Shared platform reference data

Not owned by any feature module — any module's `data/` layer may query
these directly rather than routing through the `ingredients` connector.

```sql
create table public.locales (
  code text primary key,                        -- ISO 639-1: 'es','ca','en'
  name text not null,                           -- endonym: "Español","Català","English"
  is_default boolean not null default false
);
-- Exactly one default locale, enforced structurally.
create unique index locales_single_default_idx
  on public.locales ((true)) where is_default;

create table public.units (
  id bigint generated always as identity primary key,
  code text not null unique,                    -- 'g','kg','ml','l','unit','tbsp','tsp'
  dimension text not null check (dimension in ('mass','volume','count')),
  to_base_factor numeric not null check (to_base_factor > 0)
);

create table public.regions (
  id bigint generated always as identity primary key,
  code text not null unique,                    -- 'es' (see note on granularity below)
  is_default boolean not null default false
);
-- Exactly one default region, same shape as locales.
create unique index regions_single_default_idx
  on public.regions ((true)) where is_default;
```

`to_base_factor` is the unit's ratio to one base unit per dimension (g = 1,
kg = 1000; ml = 1, l = 1000; unit = 1). Converting between two
same-dimension units is arithmetic on their factors — no pairwise
conversion table.

**Cross-dimension conversion is supported, approximately**, via two
per-ingredient bridging values (§2.3): a density for volume ↔ mass, and a
unit weight for count → mass. An earlier draft of this plan ruled
cross-dimension conversion out of scope precisely because it needs those
values; that was reversed deliberately (see `DECISIONS.md`) on the grounds
that an approximate density is no more of a fudge than an approximate egg
weight, and usability matters more here than exactness. The practical
effect is that an ingredient may offer units from more than one dimension —
flour in `g`, `kg` *and* `tbsp` — instead of being restricted to one.

`units` is shared rather than ingredient-owned because Recipes (Phase 3),
Shopping lists (Phase 5) and Fridge (Phase 6) all need it. `regions` is
shared for the same reason — a household will eventually need to say which
region it's in, which is household data, not ingredient data.

**`regions` is deliberately not called `countries`.** A seasonality region
is really *a market* — what reaches the shops here, and when — which is
climate **plus** local agriculture **plus** trade. A country is usually a
good proxy for that (and is how essentially every published seasonal
calendar is organised), but only for compact, market-integrated countries.
It breaks for continental-scale ones: US produce calendars are published
per state, and Brazil, China, India, Australia, Argentina, Chile and Canada
have the same problem. Keeping the table granularity-agnostic means `es`
today, `us_ca` or `es_canarias` later, are all just rows — no migration,
no rename. Naming it `countries` would bake in an assumption that is known
in advance to be wrong for some markets.

Conversely, a *national* market works better than raw climate would
predict, because distribution smooths internal variation: Galicia and
Almería grow different things, but a shopper in Bilbao buys Almería
tomatoes. The calendar that matters is what reaches the shelf.

**Display names for `units` and `regions` come from `next-intl` message
keys, not the database** — except `locales.name`, which is an endonym (a
language's name in its own language is the same in every UI language, so it
never needs translating).

### 2.2 Ingredients module reference data

```sql
create table public.food_groups (
  id bigint generated always as identity primary key,
  code text not null unique,                    -- 'hortalizas','frutas',...
  sort_order int not null,
  source_note text                              -- verbatim AESAN serving guidance (es)
);

create table public.nutrients (
  id bigint generated always as identity primary key,
  code text not null unique,                    -- 'energy_kcal','protein','vitamin_c',...
  measure_unit text not null,                   -- 'kJ','kcal','g','mg','µg'
  category text not null check (category in ('macronutrient','vitamin','mineral')),
  eu_mandatory boolean not null default false,  -- the 7 mandatory declarations
  sort_order int not null
);

create table public.dietary_tags (
  id bigint generated always as identity primary key,
  code text not null unique,                    -- 'gluten','milk',...,'vegetarian','vegan'
  category text not null check (category in ('allergen','diet')),
  sort_order int not null
);
```

Note `nutrients.measure_unit` is deliberately **not** an FK to `units` —
nutrient measurement units (kJ, µg) are a different vocabulary from recipe
quantity units (tbsp, unit), and conflating them would let a nutrient be
measured in tablespoons.

`food_groups.source_note` holds the verbatim Spanish guidance from the AESAN
document (e.g. *"Al menos 4 raciones a la semana, 50–60 g en seco"*). It is
a source citation captured while the document was being read — **not
user-facing display text**. Nothing consumes it yet; a future
meal-plan-recommendation feature would, and can decide then whether it needs
translating.

### 2.3 Ingredients

```sql
create table public.ingredients (
  id bigint generated always as identity primary key,
  code text not null unique,                    -- stable slug: 'milk_whole','olive_oil_evoo'
  food_group_id bigint not null references public.food_groups (id),
  nutrition_basis text not null
    check (nutrition_basis in ('per_100g','per_100ml')),
  density_g_per_ml numeric check (density_g_per_ml > 0),
  grams_per_unit   numeric check (grams_per_unit > 0),
  created_at timestamptz not null default now()
);
```

**`nutrition_basis` is decided by the DEFAULT unit's dimension, and the
rule is exactly this:** a default unit that is volume-based gives
`per_100ml`; **everything else — mass *and* count — gives `per_100g`.**
Spelling out `count` matters: eggs are sold by the unit but their
nutrition is declared per 100 g.

It has to be the *default* unit rather than "any allowed unit", and that
correction came from the assertion catching real data: milk and olive oil
are declared per 100 ml and also allow grams, so an "any volume unit"
reading reclassified both. Allowing an extra unit must not change what an
ingredient is declared against; the default unit is its natural measure,
so it is the one that decides.

**The two bridging values** turn a quantity in any allowed unit into the
nutrition basis:

- `density_g_per_ml` — volume ↔ mass. Needed only when an ingredient's
  allowed units span both dimensions (oils, milk, honey — roughly 15 of the
  catalog).
- `grams_per_unit` — count → mass (1 egg ≈ 60 g). Needed only when a
  `count` unit is allowed (~20–30 of the catalog).

Both are **deliberate approximations** and must never be presented to a
user as exact nutrition. A large egg is not a medium egg; that is an
acceptable error for meal planning and an unacceptable one for anything
claiming precision. Both are nullable because most ingredients need
neither — an ingredient with only mass units needs no bridge at all.

Nothing in Phase 2 computes with them. They are captured now for the same
reason allergens are: they are per-ingredient research (looking up an egg's
weight, olive oil's density), so gathering them during curation is far
cheaper than a second pass over the catalog later.

Three more things worth calling out:

- **`code` is the stable identity, not `name`.** Names live in a
  translations table and vary per locale, so they cannot be the natural key.
  `code` is what makes the seed script re-runnable (`on conflict (code) do
  update`) without creating duplicates.
- **`nutrition_basis`** resolves the liquids problem: EU labels declare
  per 100 g for solids and per 100 ml for liquids. Storing the basis per
  ingredient avoids silently mixing the two.
- **No `created_by`.** An earlier draft had one, from when users could
  insert ingredients. Since the catalog became admin-curated, every row
  would be written by the service role and the column would always be null.
  Dropped.

### 2.4 Companion tables

```sql
create table public.ingredient_translations (
  ingredient_id bigint not null
    references public.ingredients (id) on delete cascade,
  locale text not null references public.locales (code),
  name text not null check (length(trim(name)) > 0),
  primary key (ingredient_id, locale)
);
-- No two ingredients share a case-insensitively identical name within one
-- language. NOTE: this is case-insensitive only, NOT accent-insensitive --
-- 'Limón' and 'Limon' both pass. Closing that needs the `unaccent`
-- extension, which is deferred with the rest of search tolerance (§9).
create unique index ingredient_translations_locale_name_idx
  on public.ingredient_translations (locale, lower(name));

create table public.ingredient_nutrients (
  ingredient_id bigint not null
    references public.ingredients (id) on delete cascade,
  nutrient_id bigint not null references public.nutrients (id),
  amount numeric not null check (amount >= 0),   -- per the ingredient's nutrition_basis
  primary key (ingredient_id, nutrient_id)
);
-- No extra index here on purpose. The primary key already indexes
-- (ingredient_id, nutrient_id), which serves every "nutrients for these
-- ingredients" lookup. An earlier draft added a covering index with
-- `include (amount)` to get index-only scans; on a table of a few thousand
-- rows that fits in cache, that buys nothing measurable and costs a second
-- index to maintain. Add it if a real query ever proves it necessary.

create table public.ingredient_dietary_tags (
  ingredient_id bigint not null
    references public.ingredients (id) on delete cascade,
  tag_id bigint not null references public.dietary_tags (id),
  primary key (ingredient_id, tag_id)
);
create index ingredient_dietary_tags_tag_idx
  on public.ingredient_dietary_tags (tag_id);

create table public.ingredient_allowed_units (
  ingredient_id bigint not null
    references public.ingredients (id) on delete cascade,
  unit_id bigint not null references public.units (id),
  is_default boolean not null default false,
  primary key (ingredient_id, unit_id)
);
-- Exactly one preselected unit per ingredient.
create unique index ingredient_allowed_units_single_default_idx
  on public.ingredient_allowed_units (ingredient_id) where is_default;

create table public.ingredient_seasonality (
  ingredient_id bigint not null
    references public.ingredients (id) on delete cascade,
  region_id bigint not null references public.regions (id),
  month smallint not null check (month between 1 and 12),
  primary key (ingredient_id, region_id, month)
);
create index ingredient_seasonality_region_month_idx
  on public.ingredient_seasonality (region_id, month);
```

**One row per month, not a start/end range.** A range reads more naturally
("June to September") but breaks on two cases that are common rather than
exotic:

- **Wraparound** — Spanish citrus runs roughly November to March. As a range
  that is `start_month > end_month`, needing a special case in *every* query
  that touches it.
- **Split seasons** — plenty of crops have two harvests (spring and autumn),
  which a single range cannot express at all.

With a row per month both are free, and "what's in season here now" is one
indexed equality (`region_id = ? and month = extract(month from now())`)
rather than range arithmetic. The cost is at most 12 rows per ingredient
per region — about a thousand rows for the whole seeded catalog.

**Absence of rows is deliberately ambiguous, and that's acceptable for now.**
For region `es`, no rows on *flour* means "not seasonal, available all
year"; no rows on *mango* means "not grown here, imported all year". Both
read as "no local season", which is exactly right for a future
*prioritise-what's-in-season* feature: rows present means "seasonal here, in
these months", rows absent means "not tracked as seasonal here".
Distinguishing "never grown locally" is a **local sourcing** feature — a
genuinely separate concern, deferred (§9), and recorded here so it's a known
limitation rather than a later surprise.

**Simplification worth noting:** the default unit lives here as
`is_default`, rather than as `ingredients.default_unit_id`. With a
`default_unit_id` column, "the default unit must also be an allowed unit"
would be a cross-table rule needing a trigger to enforce. Moving the flag
into this table makes that rule *structurally impossible to violate* — no
trigger, no test needed for it. One fewer moving part.

### 2.5 What is *not* constrained in the database

These five invariants can't be expressed as a simple constraint. Each is
covered by seed-script validation **and** a pgTAP assertion, rather than a
trigger, because the only write path is a reviewed script:

- Every ingredient has at least one allowed unit.
- Every ingredient has a translation in the default locale (`es`).
- `nutrition_basis` follows the dimension rule in §2.3 — `per_100ml` for
  volume-based ingredients, `per_100g` for mass- **and count-based** ones.
- An ingredient whose allowed units span both mass and volume has a
  `density_g_per_ml`.
- An ingredient allowing a `count` unit has a `grams_per_unit`.

The last two are what make cross-dimension quantities computable at all; an
ingredient missing its bridge is not broken today (nothing computes yet) but
would silently produce wrong numbers the moment something does, which is
exactly why they are asserted in CI now rather than discovered later.

### 2.6 One change to an existing table: `households.region_id`

Everything above is new tables. This is the only Phase 2 change to
something Phase 0/1 already built, so it needs more care than the rest.

A household gets a region, defaulting to Spain, changeable afterwards by
any owner. This is what makes the seasonality data addressable — without
it, `ingredient_seasonality` is keyed by a region nothing in the app can
name.

**Ordering is load-bearing.** These statements must run after `regions`
exists *and* after it has been **seeded with its `is_default` row** — not
merely after the table is created. If the backfill runs against an empty or
unflagged `regions`, it writes NULL into every row and the final
`set not null` fails, taking the migration down with it. Simplest way to
make that impossible: put the create, the seed and this alter in **one
migration file**, in this order.

```sql
-- Same migration file as, and immediately after, creating and seeding
-- public.regions (including the row flagged is_default).
alter table public.households
  add column region_id bigint references public.regions (id);

update public.households
  set region_id = (select id from public.regions where is_default);

alter table public.households
  alter column region_id set not null;
```

Three steps rather than one, because `add column ... not null` on a table
with existing rows needs those rows populated first, and a column `default`
cannot be a subquery in Postgres — so the default region is resolved at
insert time (below), not declared on the column.

**`create_household()` must be updated**, since it inserts
`households (name)` only and would now violate the `not null`:

```sql
insert into public.households (name, region_id)
values (_name, (select id from public.regions where is_default))
returning id into _household_id;
```

Deliberately **not** adding a `_region_id` parameter. The requirement is
"defaults to Spain, changed later in settings", so creation never needs to
choose — and keeping the signature as `create_household(_name text)` means
the four existing Phase 1 pgTAP assertions that call it keep passing
unmodified. Everything else about that function stays exactly as is; its
`SECURITY DEFINER`, its `revoke ... from public`, and the comment block
explaining both are load-bearing (see `DECISIONS.md`, 2026-09-08) and must
survive the `create or replace` intact.

Resolving the default via `regions.is_default` rather than hardcoding
`where code = 'es'` keeps the country out of the function body and mirrors
how `locales.is_default` already works.

⚠️ **This makes `regions.is_default` load-bearing for the whole app.** If no
region carries the flag, that subquery returns NULL, the `not null` is
violated, and **nobody can create a household** — a total failure of a
Phase 1 feature caused by missing Phase 2 reference data. The partial unique
index only guarantees *at most* one default, never *at least* one, which
Postgres cannot express as a constraint. So it is asserted instead
(§8.1 #24): exactly one default region and exactly one default locale must
exist. Treat that assertion as protecting household creation, not as
reference-data tidiness.

**No new RLS policy is required.** The existing `households_update` policy
is already owner-only for the whole row:

```sql
using ((select private.household_role(id)) = 'owner')
with check ((select private.household_role(id)) = 'owner')
```

so "any owner may change the region, members may not" is satisfied by what
Phase 1 already built. Worth asserting in tests anyway (§8.1) — the
behaviour is inherited rather than stated, and inherited behaviour is
exactly the kind that breaks silently later.

**UI:** a region selector on the existing household settings page — same
shape as the rename control already there (Server Component page, small
`'use client'` form, Server Action). Note the sequencing: slice 3 retrofits
that page for i18n and slice 5 adds this control to it.

---

## 3. RLS model

Identical for all twelve **new** tables, and it is the core security
property of this phase. (`households`, modified in §2.6, keeps its existing
Phase 1 policies unchanged — the new `region_id` column inherits them.)

```sql
alter table public.<table> enable row level security;
alter table public.<table> force row level security;

create policy <table>_select on public.<table>
  for select to authenticated using (true);
```

No `insert`, `update` or `delete` policy exists on any of them. Under
Postgres RLS the *absence* of a policy is default-deny, so "regular users
can never write to the catalog" is expressed by writing no policy at all —
less code than permitting and then restricting. Writes happen through the
service role (seed script, Supabase Studio), which bypasses RLS.

`anon` gets no policy either, so signed-out visitors read nothing —
consistent with the rest of the app.

---

## 4. Module layout

`src/modules/ingredients/` — only `index.ts` is importable from outside.

- **`data/`** — Supabase queries, each one batched, never N+1:
  - `listIngredients({ locale, search, foodGroupId, dietaryTagIds })` — one
    query joining translations with a `coalesce` fallback to the default
    locale.
  - `getIngredient(code, locale)` — keyed on **`code`, not `id`**, since
    `code` is the stable identity (§2.3) and is therefore what detail-page
    URLs use (`/ingredients/milk_whole`). A surrogate `id` in a URL breaks
    the moment the catalog is re-seeded into a fresh environment; a slug
    doesn't. Returns the ingredient + translations + nutrients (joined to
    `nutrients` for code/unit/category) + dietary tags + allowed units +
    seasonality.
  - `listFoodGroups()`, `listDietaryTags()`.
  - **No `listUnits()` here.** `units` and `regions` are shared platform
    reference data (§2.1), which any module's `data/` layer may query
    directly — routing them through the `ingredients` connector would make
    Shopping lists depend on Ingredients just to render "kg".
- **`domain/`** — pure, framework-agnostic, unit-tested:
  - `convertQuantity(amount, fromUnit, toUnit, bridges?)` — same-dimension
    conversion from `to_base_factor` alone; cross-dimension only when the
    ingredient's `density_g_per_ml` / `grams_per_unit` is supplied, and
    returns null (or throws, decide at implementation) when the needed
    bridge is missing rather than guessing one.
  - `resolveTranslation(rows, locale, defaultLocale)` — the fallback rule,
    for cases where the fallback isn't already done in SQL.
  - `groupNutrientsByCategory(rows)` — for rendering a label in EU order.
- **`ui/`** — `IngredientList`, `IngredientCard`, `NutritionTable`,
  `DietaryTagList`, `SearchInput` (the only `'use client'` piece),
  `FoodGroupFilter`.

Pages under `src/app/` stay Server Components fetching during render, per
the standing convention.

---

## 5. Internationalization

### 5.1 ⚠️ De-risk this first

This project runs **Next.js 16.3.4**, where the former `middleware.ts` is
now **`src/proxy.ts` exporting `proxy()`** — and that file already owns the
Supabase session-refresh logic, including constructing its own
`NextResponse` and writing auth cookies onto it.

`next-intl`'s documented setup assumes `middleware.ts` and wants to own the
response too. Composing them means calling next-intl's handler inside
`proxy()` and merging both sets of cookie/header mutations onto a single
response, in the right order (locale resolution must not discard refreshed
auth cookies).

**Do this as a small spike before anything else in the i18n slice**, against
the bundled docs at `node_modules/next/dist/docs/` and next-intl's current
guidance. If composition turns out to be genuinely awkward, the fallback is
locale-prefixed routing resolved in a layout/segment rather than in the
proxy — worse for redirects, but it keeps the two concerns apart.

### 5.2 The rest

- `src/i18n/routing.ts` — `defineRouting({ locales: ['es','ca','en'],
  defaultLocale: 'es' })`.
- `src/i18n/request.ts` — `getRequestConfig` loading the locale's messages.
- `messages/es.json`, `ca.json`, `en.json` — app chrome **plus** the fixed
  vocabulary display names (`foodGroups.*`, `dietaryTags.*`, `units.*`,
  `nutrients.*`, `regions.*`), keyed by the DB `code` values.
- Retrofit the 17 existing `.tsx` files from hardcoded English to message
  keys, and add a locale switcher.

Content translations (ingredient names) come from the database; fixed
vocabulary comes from these message files. That split is the standing rule —
see `ARCHITECTURE.md`.

---

## 6. Seed data

**Reference data** (`locales`, `units`, `regions`, `food_groups`,
`nutrients`, `dietary_tags`) ships **inside the migrations**. The app references these
`code` values in message keys and query logic, so they're structural: the
app is broken without them, which makes them part of the schema, not
optional fixtures.

Counts: 3 locales · 7 units · 13 food groups · ~40 nutrients · 16 dietary
tags (14 EU allergens + vegetarian + vegan) · **1 region (`es`)**.

**Seed one region, not a world set.** `es` alone. Adding *Portugal* or
*Atlantic Europe* later is not a retrofit — it is new research you would do
at that point regardless, so there is no cost to waiting and a real cost to
guessing: every extra region multiplies curation immediately (~60 seasonal
ingredients × N regions of lookups) for regions with no users. This is the
same test that put allergens *in* Phase 2 and kept subtype relationships
*out*: the question is always "how expensive is this to reconstruct later",
and for regions the answer is "no more expensive than doing it now".

If a second similar market is added later, seed it from `es` as a starting
point and adjust — a few hundred near-duplicate rows is cheaper and stays
independently correct, versus sharing one row that is only right for one of
them.

**Ingredient data** ships as a typed dataset plus an importer:

- `data/ingredients.ts` — a typed `const` array carrying, per ingredient:
  `code`, food group, `nutrition_basis`, the bridging values
  (`density_g_per_ml` / `grams_per_unit`) where applicable, names per
  locale, nutrients, dietary tags, allowed units with one default, and
  seasonality months per region. TypeScript (not JSON) so that a typo'd
  food-group, unit, nutrient, tag or region code is a **compile error**,
  caught by `pnpm run typecheck` in CI rather than at runtime against the
  database.
- **`public.upsert_ingredient(payload jsonb)`** — a Postgres function,
  shipped as a migration, that writes one complete ingredient: the parent
  row (upserted on `code`) plus *all six* companion sets — translations,
  nutrients, dietary tags, allowed units, seasonality — replacing any
  existing companion rows for that ingredient.
- `scripts/seed-ingredients.ts` — run deliberately against an environment
  (`pnpm run seed:ingredients`), never automatically in CI. Uses the service
  role key, and calls `upsert_ingredient` **once per ingredient** via
  `supabase.rpc()`.
- The script validates before calling: default-locale name present, ≥1
  allowed unit with exactly one default, `nutrition_basis` correct for the
  unit dimensions, `density_g_per_ml` present if units span mass and volume,
  `grams_per_unit` present if a count unit is allowed, seasonality months
  within 1–12 against a known region, all amounts ≥ 0.

**Why an RPC and not a sequence of client calls — this is the part an
earlier draft got wrong.** That draft required "each ingredient written in
a single transaction" while also specifying the service-role Supabase
client. Those are incompatible: supabase-js speaks to PostgREST, where
**every call is its own transaction**, so there is no way to wrap five
table writes in one. The requirement was unbuildable as written.

Putting the whole write inside one Postgres function fixes it, because a
function body *is* a single transaction — a failure anywhere in it rolls
back everything, with no `BEGIN`/`COMMIT` for the client to manage. This is
the exact transplant of Phase 1's own resolution: `create_household` became
one function doing both inserts atomically, for precisely this reason (see
`DECISIONS.md`, 2026-09-08).

(The alternative — connecting straight to Postgres with `pg`/`postgres.js`
and a connection string, where real transactions are available — also
works, but adds a second database access path and a second credential to
the project for one script. The RPC reuses what's already there.)

**Atomicity is not optional here, and validation does not substitute for
it.** Validation guards against bad *input*; atomicity guards against
failure *during* the write — a dropped connection, a constraint violation on
the third of five row sets, a killed process. An `ingredients` row without
its default-locale translation is an ingredient with **no name in any
language**, which is exactly the orphaned-household shape one phase later.

And the re-seed path is worse than Phase 1's was: replacing companion rows
means delete-then-insert, so a failure in between doesn't merely fail to
*create* data — it **destroys existing good data**, leaving a
previously-named ingredient nameless. Re-running the seed is meant to be
the safe operation; the function boundary is what makes that true.

`upsert_ingredient` needs `SECURITY DEFINER`? **No** — unlike
`create_household`, it is never called by an end user. It is invoked only by
the seed script under the service role, which already bypasses RLS, so it
stays `SECURITY INVOKER` (the default) and should have `EXECUTE` revoked
from `public`, `anon` and `authenticated`. Granting it to `authenticated`
would hand every signed-in user a write path into the admin-curated
catalog — the one thing this phase's whole RLS model exists to prevent.

**Naming convention for variants.** Ingredient subtypes (whole vs. skimmed
milk, virgin vs. refined olive oil) are curated as ordinary, separate
ingredients — each with its own nutrition, tags and units — with **no**
explicit parent/child relationship in the schema (see §9). Name them with a
shared leading noun so the grouping stays mechanically reconstructible when
that relationship is eventually designed:

```
Leche entera · Leche semidesnatada · Leche desnatada · Leche sin lactosa
Aceite de oliva virgen extra · Aceite de oliva refinado · Aceite de girasol
Arroz blanco · Arroz integral
```

Not decoration: this convention is the entire hedge that makes deferring
the relationship cheap, so apply it consistently while curating.

**On effort:** sourcing complete EU nutrition data for 200 ingredients by
hand is the single biggest time sink in this phase — and the schema is
sparse by design, so it doesn't have to be complete. Fill the **7 mandatory
declarations** (energy, fat, saturates, carbohydrate, sugars, protein, salt)
for everything, and add vitamins/minerals opportunistically for ingredients
where it matters. Partial nutrition is a supported state, not a broken one;
the UI must render it gracefully (§7).

---

## 7. Build sequence

Five slices, each its own PR into `develop`, each independently reviewable
and mergeable. Slice 3 is independent of 1–2 and can run in parallel.

| # | Slice | Contents |
|---|---|---|
| 1 | Reference schema | `locales`, `units`, `regions`, `food_groups`, `nutrients`, `dietary_tags` + RLS + seeded reference rows + `households.region_id` (§2.6, after `regions` exists) + pgTAP |
| 2 | Ingredient schema | `ingredients` + 5 companion tables + RLS + indexes + pgTAP |
| 3 | i18n infrastructure | proxy spike, next-intl setup, message files, retrofit of Phase 1 pages, locale switcher |
| 4 | Seed dataset | `upsert_ingredient()` migration + grants, `data/ingredients.ts`, `scripts/seed-ingredients.ts`, ~150–250 ingredients, validation |
| 5 | Browse UI | `data/`, `domain/`, `ui/`, pages, the household region selector (§2.6), vitest unit tests, browser verification |

---

## 8. Testing plan

Phase 2 is done when all five layers below pass. This mirrors Phase 1's bar
(type-check, lint, unit tests, pgTAP) with browser verification added, since
this phase ships UI.

### 8.1 pgTAP — `supabase/tests/database/phase2_invariants.sql`

Self-contained, wrapped in `begin` / `rollback`, no psql meta-commands —
same shape as `phase1_invariants.sql`. Roughly 45 assertions:

**Access control (the core property of this phase):**
1. `authenticated` can `select` from `ingredients`, `ingredient_translations`,
   `ingredient_nutrients`, and each reference table.
2. `authenticated` **cannot** `insert`, `update` or `delete` on
   `ingredients` — three separate assertions.
3. `authenticated` cannot `insert` into any companion table
   (`ingredient_translations`, `ingredient_nutrients`,
   `ingredient_dietary_tags`, `ingredient_allowed_units`).
4. `authenticated` cannot write to any reference table.
5. `anon` can read nothing.

**Constraints:**
6. A second `is_default` locale is rejected.
7. Duplicate `(ingredient_id, locale)` translation rejected (PK).
8. Same name twice in one locale rejected case-insensitively
   ("Leche" vs "leche").
9. The same name in two *different* locales is allowed.
10. Negative `ingredient_nutrients.amount` rejected.
11. Invalid `nutrition_basis`, `dietary_tags.category`, `units.dimension`
    rejected.
12. `to_base_factor <= 0` rejected.
13. Two default units for one ingredient rejected.
14. `ingredient_seasonality.month` outside 1–12 rejected (0 and 13 both).
15. Duplicate `(ingredient_id, region_id, month)` seasonality row rejected
    (PK) — the same ingredient can't be listed twice for one month.
16. The same ingredient *can* hold rows for the same month in two different
    regions (the three-part key is doing its job, not over-constraining).
    Note this one needs a **second region created as a test fixture** —
    only `es` is seeded, so the assertion has to insert its own.

**Referential integrity:**
17. Deleting an ingredient cascades to all five companion tables
    (translations, nutrients, dietary tags, allowed units, seasonality).
18. A `food_group` still referenced by an ingredient cannot be deleted.
19. A `unit` still referenced by `ingredient_allowed_units` cannot be
    deleted.
20. A `region` still referenced by `ingredient_seasonality` cannot be
    deleted.

**Seed sanity (run against seeded data, catching bad curation in CI):**
21. Every ingredient has an `es` translation.
22. Every ingredient has ≥ 1 allowed unit and exactly one default.
23. Every ingredient's `nutrition_basis` follows the §2.3 rule —
    `per_100ml` if its units are volume-based, `per_100g` otherwise
    (including count-based ones like eggs).
24. All 13 food groups, 16 dietary tags, 3 locales, 1 region and the full
    nutrient list are present — **and exactly one locale and exactly one
    region carry `is_default`.** This is not tidiness: a missing default
    region makes `create_household()` fail for everyone (§2.6), and the
    partial unique index can only guarantee *at most* one, never at least
    one.
25. Every ingredient whose allowed units span mass and volume has a
    `density_g_per_ml`; every ingredient allowing a `count` unit has a
    `grams_per_unit`. Without these a cross-dimension quantity silently
    becomes uncomputable later.

**`households.region_id` (§2.6 — inherited behaviour, so assert it
explicitly):**
26. A new household created via `create_household()` gets the default
    region (`es`) automatically.
27. An **owner** can update their household's `region_id`.
28. A plain **member** cannot — the existing `households_update` policy
    already refuses it, which is precisely why it's worth a test.
29. A non-member cannot update another household's region.
30. `region_id` cannot be set to a non-existent region (FK), and cannot be
    set to null.

**Write-path atomicity (`upsert_ingredient()` is the only real write path,
and assertions 21–25 only check the resulting state — these check the
transition that produces it):**
31. `authenticated` and `anon` **cannot execute `upsert_ingredient()`**.
    A grant here would be a write path into the admin-curated catalog,
    defeating the entire RLS model of this phase.
32. A full `upsert_ingredient()` call produces the parent row *and* every
    companion row — the happy-path equivalent of Phase 1's
    "`create_household` succeeds for a user with a profile".
33. Re-running `upsert_ingredient()` for an existing `code` updates it in
    place and does not create a duplicate (idempotency).
34. A **failed** `upsert_ingredient()` call leaves no orphaned
    `ingredients` row behind — the direct twin of Phase 1's
    "a failed `create_household` does not leave an orphaned household
    behind (atomic)" (`phase1_invariants.sql:L85`). Force the failure with
    a deliberately invalid companion row (e.g. a negative nutrient amount,
    which assertion 10 already proves is rejected) and assert the parent
    row did not survive it.
35. A **failed re-seed** of an existing ingredient leaves its previous
    companion rows intact — the delete-then-insert path must not destroy a
    good name on the way to failing (§6). This is the case Phase 1 never
    had, and the more dangerous one.

### 8.2 Unit tests (vitest)

- `convertQuantity`: g↔kg and ml↔l round-trips; identity conversion;
  fractional amounts; zero; cross-dimension (mass→volume) refused;
  unknown unit refused.
- `resolveTranslation`: requested locale present; absent → default locale;
  both absent → defined, non-crashing behaviour.
- `groupNutrientsByCategory`: correct ordering and grouping; an ingredient
  with no nutrient rows returns empty, not a crash.

### 8.3 Existing CI gates

`pnpm run typecheck`, `pnpm run lint` (now covering the new module against
the boundary rule), `pnpm run test`, and the `db-tests` job.

### 8.4 Browser verification (required — this phase ships UI)

Run the dev server and check by hand:
- Browse page renders in `es`, `ca` and `en`; the locale switcher works.
- An ingredient with **no** Catalan translation shows its Spanish name when
  viewing in Catalan (the fallback path).
- Search finds an ingredient by its name in the active locale.
- Filtering by food group and by dietary tag works.
- Detail page renders the nutrition table in EU order with correct units,
  allergen/diet tags, and allowed units.
- An ingredient with **partial or no** nutrition data renders gracefully —
  no empty table shell, no `NaN`, no crash.
- Signed-out access to the ingredient pages redirects to login.
- Layout holds at ~400 px wide (responsive from the start, per `CLAUDE.md`).

### 8.5 Supabase advisors

Run the security and performance advisors against preprod after migrating.
This is not ceremony: advisors already caught a real `PUBLIC`-grant bug in
Phase 1 that a hand-written revoke had missed (see `DECISIONS.md`,
2026-09-08). Expect and resolve anything flagged on the ten new tables.

---

## 9. Explicitly out of scope

Deferred with reasoning already recorded in `DECISIONS.md` / `PLAN.md`:
substitutes and subtypes; typo/accent-tolerant search (`pg_trgm`,
`unaccent` — addable later purely as an index, no schema change); an in-app
admin UI; an ingredient request/suggestion flow for households; any
consumption of `food_groups.source_note`; daily-intake aggregation (that
arrives with meal plans).

**No longer deferred:** cross-dimension unit conversion was previously
listed here as out of scope because it needs per-ingredient density. That
was reversed — `density_g_per_ml` and `grams_per_unit` are now captured in
§2.3 as deliberate approximations, so an ingredient may offer units across
dimensions. The *conversion logic* still isn't written in Phase 2 (nothing
computes quantities yet); what changed is that the data it will need is
being gathered during curation instead of requiring a second pass later.

Seasonality-specific deferrals — the schema is built in Phase 2, but
nothing consumes it yet:
- **Any seasonal prioritisation feature** (surfacing in-season ingredients
  or ranking recipes by them). The data is captured now; the behaviour
  arrives with Recipes or Meal plans. Note the AESAN source document
  already advocates it — *"Comer de temporada ayuda a contribuir al
  mantenimiento de una agricultura sostenible"* (p. 16) — so the eventual
  feature has a documented basis in the same reference the food groups
  came from.
- **Region hierarchy** (`parent_region_id`, so `es_canarias` could inherit
  from `es`). Same reasoning as the subtype relationship: no behaviour
  consumes it, and the thing that would drive its design — a fallback rule
  structurally identical to the locale fallback — isn't needed until a
  second region exists.
- ~~A household's own region setting~~ — **now in scope**, see §2.6.
  Pulled into Phase 2 because without it the seasonality data is keyed by
  a region nothing in the app can name, and because the household settings
  page is already being touched this phase for the i18n retrofit.
- **Local sourcing** — distinguishing "grown here, out of season" from
  "never grown here, always imported". See the absence-ambiguity note in
  §2.4; a genuinely separate concern from seasonality.

---

## 10. Risks carried into this phase

1. **`next-intl` × `proxy.ts` composition** (§5.1) — the one genuine
   unknown. Spike it first; everything else in the phase is well-understood.
2. **The `db-tests` CI job has never actually run.** Phase 1 flagged it as
   written-but-unverified (no Docker in that environment). Phase 2 adds ~30
   assertions that depend on it. Confirm the job genuinely runs and fails
   correctly — a green check from a job that silently skipped is worse than
   no job.
3. **Nutrition data curation effort** — mitigated by the sparse-by-design
   schema and the mandatory-seven-first approach (§6), but it remains the
   longest pole in this phase.
