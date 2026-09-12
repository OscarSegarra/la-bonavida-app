# Phase 3 — Recipes: build plan

Detailed build spec for Phase 3. `PLAN.md` keeps the roadmap-level
summary; this file is what gets built against, in the same way
`PHASE_2_PLAN.md` served Phase 2.

**Phase 3 is not the Phase 3 the original roadmap described.** The roadmap
had households writing their own recipes. The requirements settled on
2026-09-12 replaced that with a global, admin-curated catalog seeded by
us, with user-written recipes deferred until the app has been properly
tested. Every reversal that follows from that is recorded in
`DECISIONS.md`; this plan describes only the thing being built.

---

## 1. What Phase 3 ships

- A **global recipe catalog**: every authenticated user can read every
  recipe. No user can create, edit or delete one. The only write path is
  the `upsert_recipe` database function, called by
  `pnpm run seed:recipes` under the service role — the exact shape Phase 2
  used for ingredients.
- **Every recipe in all three locales** (es, ca, en), written by us, via a
  `recipe_translations` companion table.
- **Ordered instruction steps**, translated per locale, which the cook can
  tick off while cooking. Ticks are client-side only and do not survive a
  reload.
- **Recipe lines** that reference *either* a catalog ingredient *or*
  another recipe, with units validated differently per branch.
- A separate, hand-applied **tag** vocabulary.
- **Derived allergen and diet facts**, and filtering by them. These are
  *not* deferred with the rest of the nutrition work: they are set
  operations over the lines with no unit arithmetic, and a recipe catalog
  that cannot tell someone whether a dish contains gluten is a trust
  problem rather than a missing nicety.
- Everything the nutrition roll-up will need, but **not the roll-up
  itself** — see §4. Recursive nutrition totals and per-nutrient overrides
  are Phase 3b, gated on the catalog staying small until they exist.
- **Retirement, not deletion**, matching the ingredient catalog.
- Browse, search (by name **and by ingredient**) and detail UI in all
  three locales, with a recipe scalable to a short list of **offered**
  serving sizes — computed, filtered so nothing ever comes out as half an
  egg, and never rounded.

**Deliberately not in Phase 3** (§11 has the full list): user-written
recipes — the ownership columns land now, the feature does not —
collections, photos, prep/cook times, ratings, scaling by servings.

---

## 2. Schema

All ids are `bigint generated always as identity`, and everything the seed
dataset addresses is addressed by `code`, never by id — the same
portability rule Phase 2 set, so a dataset applies identically to preprod
and prod.

### 2.1 `recipes`

```sql
create table public.recipes (
  id             bigint generated always as identity primary key,
  code           text not null unique,
  owner_user_id  uuid null references public.profiles (id) on delete restrict,
  visibility     text not null default 'shared'
                   check (visibility in ('private', 'shared')),
  servings       integer not null check (servings > 0),
  min_servings   integer not null default 1
                   check (min_servings > 0 and min_servings <= servings),
  yield_quantity numeric not null check (yield_quantity > 0),
  yield_unit_id  bigint not null references public.units (id),
  retired_at     timestamptz null,
  created_at     timestamptz not null default now(),

  -- A catalog recipe has no owner, so it cannot be private *to* anyone.
  check (owner_user_id is not null or visibility = 'shared')
);
```

`shared` means "visible to the people subscribed to me" (§13.1), **not**
"visible to the world" — which is why the values are `private` / `shared`
rather than the more obvious `private` / `public`. A catalog recipe is
visible because it has no owner, not because of this flag.

`owner_user_id null` means **this is a catalog recipe, owned by nobody and
readable by everybody**. In Phase 3 every row has it null. The column
exists now for the same reason `sub_recipe_id` does: today it is one
nullable column, and after real recipes exist it would be a data migration
against live data.

`owner_user_id` references `profiles(id)` rather than `auth.users(id)`,
following the Phase 1 rule that participation in app data requires a
profile. `on delete restrict` means deleting a person is blocked while
they own recipes — deliberate, and the same stance Phase 1 took on the
sole owner of a household.

**`min_servings` is what makes scaling honest.** A recipe can be scaled to
however many people are eating, but not every recipe scales down: you
cannot make a pie for one. The floor is a property of the recipe, so it is
stated by whoever writes it, and the scaling control simply will not go
below it. `not null` with a default of 1 means most recipes say nothing
and behave as before, and the check ties it to `servings` so a recipe
cannot declare a floor above its own stated yield. There is deliberately
no `max_servings` — a paella for forty is a real limit too, but nobody has
hit it, and it is the same one-line addition whenever they do.

**Both `servings` and `yield_*` are required, and they are different
numbers.** `servings` is how many people the recipe feeds and is what
per-serving nutrition divides by. `yield_quantity` + `yield_unit_id` are
how much finished food it makes, and are what a sub-recipe line divides
by. They cannot be derived from each other or from the inputs: 300 g of
raw rice becomes roughly 750 g cooked. Earlier planning made yield
optional for recipes never used as sub-recipes; with an admin-curated
catalog that concession buys nothing, because we fill in both — so
requiring them keeps every recipe usable as a sub-recipe without a later
backfill.

### 2.2 Translations and steps

```sql
create table public.recipe_translations (
  recipe_id   bigint not null references public.recipes (id) on delete cascade,
  locale      text not null references public.locales (code),
  title       text not null check (length(trim(title)) > 0),
  description text null,
  primary key (recipe_id, locale)
);

create table public.recipe_steps (
  id        bigint generated always as identity primary key,
  recipe_id bigint not null references public.recipes (id) on delete cascade,
  position  integer not null check (position > 0),
  unique (recipe_id, position)
);

create table public.recipe_step_translations (
  step_id bigint not null references public.recipe_steps (id) on delete cascade,
  locale  text not null references public.locales (code),
  body    text not null check (length(trim(body)) > 0),
  primary key (step_id, locale)
);
```

Steps are rows, not one block of text with newlines in it, because the
cook ticks off individual steps — which needs each step to have its own
identity. The rejected alternative was a JSON array inside
`recipe_translations.instructions`: fewer tables, but the step at index 2
in Spanish is not guaranteed to be the step at index 2 in Catalan, and
nothing in the database would stop the two languages from disagreeing on
how many steps a recipe has. With `recipe_steps` as the parent and
translations hanging off it, that disagreement is structurally impossible.

Timings, temperatures and per-step images are deliberately absent —
whatever a step needs to say, it says in its text.

### 2.3 `recipe_lines`

```sql
create table public.recipe_lines (
  id            bigint generated always as identity primary key,
  recipe_id     bigint not null references public.recipes (id) on delete cascade,
  position      integer not null check (position > 0),
  ingredient_id bigint null references public.ingredients (id) on delete restrict,
  sub_recipe_id bigint null references public.recipes (id) on delete restrict,
  quantity      numeric not null check (quantity > 0),
  unit_id       bigint not null references public.units (id),
  unique (recipe_id, position),
  check (num_nonnulls(ingredient_id, sub_recipe_id) = 1),
  check (sub_recipe_id is distinct from recipe_id)
);
```

**`quantity` is `not null` and must be positive.** There is no "to taste"
line: salt is entered as a real number of grams, and the wording
"(adjust to taste)" belongs in the step text, which is already being
written in three languages. A nullable quantity would have meant every
consumer — nutrition now, the shopping list later — carrying a
"contributes nothing" branch forever, to express something the recipe text
says better.

**There are no per-line notes.** "Finely chopped" is an instruction and
lives in a step. A note column would need its own translation companion
table to be readable in three languages — a whole table for one field that
duplicates text we are already writing.

`on delete restrict` on both reference columns is what answers "what
happens if it gets deleted" — see §2.8 and §3.

**Two lines may name the same ingredient**, deliberately: onion added at
the start and more at the end is a real recipe, so there is no unique
constraint on `(recipe_id, ingredient_id)`. The consequence belongs to
whoever consumes the lines — nutrition sums them, and Phase 5's shopping
list must aggregate them into one item rather than listing onion twice.

### 2.4 Tags

```sql
create table public.recipe_tags (
  id   bigint generated always as identity primary key,
  code text not null unique
);

create table public.recipe_tag_translations (
  tag_id bigint not null references public.recipe_tags (id) on delete cascade,
  locale text not null references public.locales (code),
  name   text not null check (length(trim(name)) > 0),
  primary key (tag_id, locale)
);

create table public.recipe_tag_assignments (
  recipe_id bigint not null references public.recipes (id) on delete cascade,
  tag_id    bigint not null references public.recipe_tags (id) on delete restrict,
  primary key (recipe_id, tag_id)
);
```

Tags are for things a person decides: `rapido`, `cena`, `postre`,
`navidad`, `una_olla`. They are **not** for diet or allergen claims —
those are computed from the lines (§4.3), because a hand-typed "vegan" tag
can contradict the recipe's own ingredients and there would be no way to
tell which one was lying.

The naming deviates slightly from Phase 2's `dietary_tags` /
`ingredient_dietary_tags` pair, because `recipe_recipe_tags` would be an
unreadable table name. Vocabulary is `recipe_tags`; the join is
`recipe_tag_assignments`.

### 2.5 `recipe_nutrient_overrides`

```sql
create table public.recipe_nutrient_overrides (
  recipe_id   bigint not null references public.recipes (id) on delete cascade,
  nutrient_id bigint not null references public.nutrients (id),
  value       numeric not null check (value >= 0),
  primary key (recipe_id, nutrient_id)
);
```

One row per nutrient that cooking changes enough to be worth correcting.
Everything without a row keeps computing from the lines, so correcting the
fat content of a fried dish does not mean retyping thirty vitamin values.

**`value` is the total for the whole recipe as made**, in the nutrient's
own `measure_unit` — the same basis the computed sum produces. Per-serving
and per-100 g are then both derived by dividing (§4.2), so there is one
number stored and one place it can be wrong. Storing per-100 g instead
would have meant the stored value silently depended on `yield_quantity`,
and editing the yield would quietly change a number a human had entered
deliberately.

**An override wins wherever it exists, and it stays.** If the ingredients
of a recipe later change, or a sub-recipe it uses is re-seeded with
corrected values, the override is not recalculated and not flagged as
stale. That is the intended behaviour: an override represents a
measurement of the finished dish, which does not become wrong because a
reference table was edited.

### 2.6 Two changes to an existing table: convertibility and divisibility

Phase 2 left `ingredients.density_g_per_ml` and
`ingredients.grams_per_unit` nullable and unused, because nothing computed
quantities yet. Phase 3 computes quantities, so a missing factor becomes a
recipe whose nutrition silently cannot be calculated.

Making both columns `not null` was considered and **rejected**: olive oil
has no meaningful grams-per-unit, flour has no per-unit weight, and
inventing numbers for them is worse than leaving them null, because a
fabricated value is indistinguishable from a measured one — and Phase 2's
own record says these approximations must never be surfaced as exact.

The precise rule is instead: **every unit an ingredient allows must be
convertible to that ingredient's `nutrition_basis` dimension.**

| allowed unit | `nutrition_basis` | required |
|---|---|---|
| mass | `per_100g` | — |
| volume | `per_100ml` | — |
| volume | `per_100g` | `density_g_per_ml` |
| mass | `per_100ml` | `density_g_per_ml` |
| count | `per_100g` | `grams_per_unit` |
| count | `per_100ml` | `grams_per_unit` **and** `density_g_per_ml` |

Enforced by a `private.ingredient_unit_is_convertible(ingredient_id,
unit_id)` helper plus constraint triggers on **both**
`ingredient_allowed_units` (insert/update) and `ingredients` (update of
`nutrition_basis`, `density_g_per_ml`, `grams_per_unit`) — both
directions, because otherwise the rule could be broken by nulling a factor
on an ingredient whose allowed units were already fine. The migration
validates existing rows before adding the triggers, and fails loudly if
the current catalog violates the rule.

This asks for a number only where a number genuinely exists, and it gives
the guarantee that actually matters: **no recipe line can be written whose
nutrition cannot be computed.**

**The second change is one boolean**, and it exists so that scaling a
recipe never produces half an egg:

```sql
alter table public.ingredients
  add column count_divisible boolean null;
```

`true` means a fraction of one is a real thing a person can use — half an
apple, half an onion, half a lemon, half a pepper. `false` means it only
makes sense whole: an egg, a bay leaf, a stock cube, a tin. It is
**required exactly where a count unit is allowed** and must stay null
otherwise, which is the same conditional shape as the conversion factors
above and is enforced by the same pair of triggers rather than a second
mechanism. Asking whether an onion is divisible is meaningless for olive
oil, and a `not null default` would answer the question for ingredients
nobody ever counts.

It is gathered **now, during curation**, even though only the scaling UI
reads it — the Phase 2 precedent for `density_g_per_ml` and
`grams_per_unit`, and for the same reason: deciding it while already
looking at the ingredient is free, and revisiting the whole catalog later
is a second research pass. What it drives is in §6.1.

### 2.7 Indexes

Phase 2 dropped an index as an unearned optimisation on a few-thousand-row
table, and that instinct is right — but these three are not optimisations,
they back rules that run on **every write**:

```sql
create index recipe_lines_sub_recipe_idx on public.recipe_lines (sub_recipe_id)
  where sub_recipe_id is not null;
create index recipe_lines_ingredient_idx on public.recipe_lines (ingredient_id)
  where ingredient_id is not null;
create index recipe_lines_recipe_idx     on public.recipe_lines (recipe_id);
```

The first is walked by the cycle and depth triggers and by "which recipes
use this one?" before a retirement. The second answers "is any live recipe
using this ingredient?", which runs on every attempt to retire an
ingredient. The third is the parent lookup every read and the nutrition
recursion does. Without them each of those is a sequential scan of the
whole line table on every single write.

### 2.8 What is *not* constrained in the database

- **That a recipe has at least one line.** A recipe wrapping a single
  ingredient — an apple, a handful of almonds, a glass of milk — is a real
  and intended thing, and "at least one row in a child table" is not
  expressible as a table constraint anyway. `upsert_recipe` rejects an
  empty payload; pgTAP asserts that it does.
- **That a recipe has a translation in every locale.** Same limitation;
  `upsert_recipe` requires the default locale and pgTAP asserts the
  catalog carries all three.
- **That tags are mutually sensible.** `rapido` + `lento` is nonsense no
  constraint should be asked to police.
- **Nutritional plausibility.** A recipe can compute to an absurd number
  if its lines say so; that is a curation error, not a schema one.

---

## 3. Invariants enforced in Postgres

Each of these is a real rule, so it lives in the database, not in a Server
Action — the project's standing position. Each gets a pgTAP test that
calls the write path **with what it should refuse** (§10), the habit the
Phase 2 post-build review established.

1. **Exactly one of `ingredient_id` / `sub_recipe_id`** — a check
   constraint (§2.3).
2. **Unit validity, two branches.** An ingredient line's `unit_id` must
   appear in `ingredient_allowed_units` for that ingredient. A sub-recipe
   line's `unit_id` must share a **dimension** with the sub-recipe's
   `yield_unit_id` — "200 g of cooked rice" against a yield stated in kg
   is fine, "200 ml" against a yield in grams is not, because a recipe has
   no density of its own. Phase 2's `ingredient_allowed_units` comment
   promised only the first half; migration `20260912110000` already
   corrected it.
3. **No cycles.** A recursive CTE in a constraint trigger on
   `recipe_lines` insert/update: if the new `sub_recipe_id` can reach
   `recipe_id`, refuse. A → B → A is an infinite loop in both nutrition
   and the shopping list.
4. **Depth cap of 5.** The same trigger refuses a line that would nest
   sub-recipes more than five deep. Two levels is the realistic maximum,
   so this should never fire — it exists so that a mistake becomes a clear
   error instead of a runaway query.
5. **A live recipe may never reference a retired ingredient**, in both
   directions: a line cannot be written onto a retired ingredient, and
   `set_ingredient_retired` refuses while a live recipe references it.
   This one is easy to miss and nasty: retirement *hides the row from
   readers*, so without this rule a recipe would render with an ingredient
   line silently missing and its nutrition quietly too low — no error,
   just a smaller number.
6. **The same rule for retired sub-recipes, also in both directions:** a
   line cannot be written onto a retired recipe, and `set_recipe_retired`
   refuses while a live recipe uses it as a sub-recipe. The second half is
   the one that is easy to leave out, and it is the half that matters —
   retiring a recipe is the common operation, writing a line onto an
   already-retired one is not.
7. **A recipe cannot reference itself** — a check constraint, so the
   trivial cycle is caught without the recursive trigger having to run.

**One implementation trap in the depth cap.** The depth of a chain is not
the depth *below* the line being inserted. Adding "B is an ingredient of
A" can exceed the cap through A's own ancestors: if A is already used four
levels up someone else's recipe, a two-level B pushes the whole chain to
six. The trigger must therefore measure `depth_above(A) + depth_below(B) +
1`, not `depth_below(B)`. Measuring only downward would enforce the cap
inconsistently depending on which line happened to be written last — the
kind of bug that passes every test written from the happy path, so the
pgTAP case is explicitly "build a legal 4-deep chain, then attach a 2-deep
sub-recipe at the top and assert the refusal".

---

## 4. Nutrition: the exact arithmetic

> **§4.1 and §4.2 are deferred to Phase 3b, with a hard gate. §4.3 is
> not** — the derived allergen and diet facts ship in Phase 3, because
> they need no unit arithmetic at all (they are a union and an
> intersection over the same recursive walk) and because a catalog that
> cannot answer "does this contain gluten" is not safe to browse.
>
> The requirement for the rest is that the *system* is in place, not that
> it runs from day one. Everything in §4.1–4.2 is a `create function` and
> a `create table` against a catalog
> that already has the right shape — no backfill, no data migration, no
> rewrite of anything Phase 3 ships. So it waits.
>
> **The gate: it must be built before the catalog grows past ~25
> recipes.** Not because the code gets harder — it does not — but because
> *the data does*. Turning the roll-up on is when a line that cannot be
> converted, or a yield stated in the wrong dimension, finally surfaces.
> Finding that across 20 recipes is an afternoon; across 200 it is a
> curation project. The `seed:recipes` importer should print the count and
> the gate on every run, so "later" cannot quietly become "never".
>
> **What does *not* wait**, because it is the part that gets expensive:
> `servings`, `yield_quantity` and `yield_unit_id` are `not null` columns
> on a table that will hold rows (§2.1), and the ingredient convertibility
> constraint (§2.6) is cheap against today's 62 ingredients and grows with
> the catalog. Both ship in Phase 3.

Computed on read by a SQL function, never stored. The Phase 2 seed is
re-runnable and updates ingredient nutrition, so a stored sum would go
stale the moment a value was corrected, with nothing to indicate that it
had. Overrides are the only stored numbers, and they are stored precisely
because they are *not* derivable.

It is a SQL function rather than TypeScript for a second reason: the
recipes module must not reach into the ingredients module's tables, and a
database function is not a module-boundary crossing — the recipes module
calls one RPC.

### 4.1 One recipe's total

For each nutrient, sum the contributions of every line, then replace any
nutrient that has an override row with the override value.

**An ingredient line** converts its quantity into the ingredient's
`nutrition_basis` dimension, using `units.to_base_factor` within a
dimension and `density_g_per_ml` / `grams_per_unit` across dimensions
(§2.6 guarantees the factor exists), then:

```
contribution = value_per_basis * amount_in_basis_units / 100
```

**A sub-recipe line** takes a fraction of the sub-recipe's *total*:

```
fraction     = quantity_in_base_units / yield_quantity_in_base_units
contribution = fraction * sub_recipe_total
```

Both quantities are in the base unit of their shared dimension, which
invariant 2 guarantees they have. No density is needed, which is why a
recipe never needs one of its own. `sub_recipe_total` is this same
function applied recursively — so a sub-recipe's own overrides are already
baked into the number that flows upward.

### 4.2 Derived views of the total

- **Per serving** = total ÷ `servings`. Always available.
- **Per 100 g** = total ÷ (yield converted to grams) × 100 — **only when
  `yield_unit_id` is a mass unit.** A recipe measured in millilitres or in
  portions has no density, so per-100 g is not shown rather than guessed.

### 4.3 Completeness, and derived diet/allergen facts

Phase 2 nutrient data is deliberately sparse — every ingredient carries
the eight EU-mandatory values, and beyond that only what is known. So a
sum over vitamin B12 may cover three of a recipe's seven lines and still
look like a complete answer.

The function therefore returns, per nutrient, the value **and** a
`complete` boolean that is false when any contributing line lacked data
for it. The UI shows an incomplete value as "at least", not as a fact.

**Three states, not two** — and collapsing them is the mistake to avoid.
A nutrient no contributing ingredient has data for sums to zero with
`complete = false`, and rendering that as "at least 0 µg" is worse than
useless: it reads as a measurement. So the row is **omitted entirely**
when nothing contributed, shown as "at least X" when some lines
contributed, and shown plainly when all did. This matches what
`NutritionTable` already does for ingredients, where a sparse row simply
does not appear.
This is the same instinct as the retired-ingredient rule: the failure mode
being designed against is a number that is wrong without looking wrong.

Diet and allergen facts come from the same recursive walk down to leaf
ingredients, with an asymmetry that is easy to get backwards:

- **Allergens are a union.** If any leaf ingredient contains gluten, the
  recipe contains gluten.
- **Diets are an intersection.** A recipe is vegan only if *every* leaf
  ingredient is vegan.

---

## 5. RLS model

`recipes` and every companion table: RLS enabled and forced.

- **Select**, to `authenticated` only (anonymous visitors get nothing,
  matching Phase 2):
  `retired_at is null and (owner_user_id is null or owner_user_id = (select auth.uid()))`.
  The owner clause is inert in Phase 3 — no user can create a recipe — but
  it is correct as written, so the policy does not need revisiting when
  they can.
- Companion tables (`recipe_translations`, `recipe_steps`,
  `recipe_step_translations`, `recipe_lines`, `recipe_tag_assignments`,
  `recipe_nutrient_overrides`) select via an `exists` on a visible parent
  recipe, so retirement and ownership are enforced in exactly one place.
- `recipe_tags` / `recipe_tag_translations` are plain reference data:
  readable by `authenticated`, like `nutrients` and `units`.
- **No insert, update or delete policies exist at all.** With RLS forced
  and no policy, Postgres refuses every write regardless of what the
  application asks for. There is no user write path to secure, which is
  the whole point of an admin-curated catalog.
- `execute` on `public.upsert_recipe` and `public.set_recipe_retired` is
  **revoked from `anon` and `authenticated`**, exactly as Phase 2 does for
  `upsert_ingredient`. Both are `security definer` with a pinned
  `search_path` — migration `20260912070000` is the precedent, and the
  reason it exists is that forgetting it was a real finding.

---

## 6. Module layout

```
src/modules/recipes/
  data/recipes.ts     listRecipes, getRecipe(code), searchRecipes (name + ingredient)
  data/nutrition.ts   one rpc() call per recipe                      [3b]
  domain/scaling.ts   offeredSizes(recipe) + scaled line quantities
  domain/search.ts    matching over already-fetched rows
  domain/basics.ts    isBasic(recipe): one line, no steps
  ui/RecipeList.tsx   list + filters, basics hidden by default (server)
  ui/RecipeSteps.tsx  the tickable step list, localStorage-backed ('use client')
  ui/ServingsPicker.tsx  the offered sizes, nothing else selectable ('use client')
  ui/RecipeLines.tsx  ingredient / sub-recipe lines, both linked (server)
  index.ts            the only file anything outside the module may import
```

**Two things currently inside the ingredients module have to move out**,
because a second module now needs them and the boundary lint rule will
correctly refuse a cross-module import. Both moves follow an existing
precedent rather than inventing a rule: `listUnits()` was *removed* from
the ingredients module during the Phase 2 review, because units are shared
platform reference data and wrapping them in one module's connector
implied an ownership that does not exist.

1. **Accent-tolerant text matching**, today in
   `ingredients/domain/search.ts`. Recipe search needs identical
   behaviour, and so will collections and the fridge. → **`src/lib/text.ts`**,
   a platform utility owned by no module, leaving each module's
   `search.ts` to the part that is genuinely about its own data.
2. **Nutrient presentation**, today split between
   `ingredients/domain/nutrition.ts` (`groupNutrientsByCategory`,
   `formatNutrientAmount`, `NutrientValue`) and
   `ingredients/ui/NutritionTable.tsx`. Neither is about ingredients —
   they are about **nutrients**, which are shared reference data exactly
   like units and locales. A recipe's nutrition panel is the same EU
   declaration table with the same indented sub-declarations and the same
   per-locale number formatting. → **`src/lib/nutrition/`**, imported
   directly by both modules.

Exporting `NutritionTable` from the ingredients connector was the
alternative, and it is the wrong shape for the same reason `listUnits()`
was: it would say the recipes module gets its nutrition rendering *from
the ingredients module*, which is not true and would make a future change
to nutrient display look like an ingredients change.

Both moves are pure relocations with no behaviour change, so they belong
in the first Phase 3 PR, before anything depends on them.

### 6.1 What the UI actually does

Settled in a user-perspective review of this plan, where each of these was
either a missing feature or something that would read as a bug.

**The browse list hides "basics" by default.** Treating a piece of fruit
or a glass of milk as a recipe is deliberate — it is what lets a meal plan
say "breakfast: an apple" without a second concept, and why Phases 5 and 6
only ever deal in recipes. But it means the catalog fills with
single-ingredient entries, and a list where *Manzana* outnumbers *Paella
valenciana* is a bad list. **A basic is derived, not tagged: exactly one
line and no steps.** That is already what the word means, so there is no
tagging discipline to keep up and nothing to drift. A toggle shows them,
search always finds them, and meal plans use them normally. If a
counterexample ever appears, a `basico` tag can override the derivation
without a migration — but a real dish has at least one step, so it should
not.

**Search covers names and ingredients.** "What can I make with chicken" is
the second thing anyone tries, and `recipe_lines` already holds the
answer — it is a join, not new schema. Name matching reuses the shared
accent-folding helper.

**Filtering is by tag, allergen and diet**, which is why the derived facts
(§4.3) cannot wait for 3b.

**On a recipe page:**

- **Every ingredient line links to that ingredient's page**, and every
  sub-recipe line links to that recipe. A line that names something the
  app already has a page for and does not link to it is a dead end.
- **The yield is not shown.** `yield_quantity` is plumbing for sub-recipe
  arithmetic; "Serves 4" and "Yield 750 g" side by side only invites the
  question of which one matters.
- **Servings are chosen from a short list of offered sizes**, not typed
  freely — "2 / 4 / 8", the way a person thinks about it. See §6.2 for how
  the list is built and why nothing is ever rounded.
- **Steps are ticked off, and the ticks survive a reload** via
  `localStorage` keyed by recipe. The scenario this feature exists for is
  cooking with a phone on the counter, where the screen sleeps and the
  page gets discarded — losing progress exactly then would read as a bug.
  `localStorage` keeps it device-local with no table, no RLS, and no "does
  my partner see my ticks" question to answer. Wrapped in try/catch, since
  a private window can refuse it.

**The empty state says why you cannot add a recipe.** Curated-for-now is a
deliberate decision, and an app that simply has no "add" button reads as
one that is broken or unfinished. A request flow joins the same deferred
list as ingredient requests.

### 6.2 Serving sizes: computed, filtered, never rounded

A recipe is scaled by multiplying every line by `target / servings`. Done
naively that produces 1.5 eggs, and no rounding rule fixes that — rounding
to 2 changes the recipe, and printing 1,5 reads like software output
rather than cooking.

**So the quantities are never adjusted to fit the sizes; the sizes are
filtered to fit the quantities.** A serving count is offered only if every
line comes out usable at that factor:

- **Mass and volume lines never object.** 75 g is 75 g; any factor works.
- **A count line of a divisible ingredient** accepts a fraction — half an
  onion is a real thing.
- **A count line of an indivisible ingredient** must come out whole. Two
  eggs halve to one; one egg does not halve at all.
- **Nothing below `min_servings`**, whatever the arithmetic says — a pie
  for one fails for a reason that has nothing to do with divisibility.

Worked through: a tortilla serving 4, with 4 eggs (indivisible), 1 onion
(divisible) and 300 g of potato, offers **2** (2 eggs, ½ cebolla, 150 g),
**4** and **8**. A recipe using a single egg for 4 people simply does not
offer 2, because it genuinely cannot be made for two without half an egg,
and declining is more honest than displaying 0.5.

The candidate factors are the small, human ones — ×½, ×1, ×1½, ×2, ×3 —
filtered by the rules above. Every number a cook ever sees is exact.

**Why computed rather than hand-written variants.** Writing a separate
ingredient list per size was the alternative, and it delivers the same
experience — a picker with 2, 4 and 8 on it. It was rejected on
maintenance: a hundred recipes becomes three hundred hand-written
ingredient lists, and correcting a quantity in the 4-person version means
remembering the 2- and the 8-. N copies that can silently drift is the
shape this project already rejected for column-per-locale and for wide
nutrition tables, and it multiplies the curation cost per recipe at
exactly the moment the bottleneck is how many recipes exist at all.

**What that costs, stated plainly:** scaling is linear and cooking is not.
A paella for eight wants a wider pan and different timing, and arithmetic
cannot say so. The answer is that a genuinely different method is a
genuinely different recipe — "Paella para 8" as its own entry, with its
own steps — which the catalog already supports without any new concept.
Linking related recipes is the same shape as the deferred ingredient
substitutes/subtypes relationship and can be designed with it, if it earns
its place. Hand-written variants remain available as a later child table
on `recipes` if this turns out to be wrong; nothing here forecloses them.

This is also what retires the rounding problem entirely: with no rounding
step, there is no per-ingredient rounding rule, no "of 1,5" caveat in the
UI, and no case where a scaled recipe's quantities disagree with its
nutrition.

---

## 7. Internationalization

Straight reuse of the Phase 2 pattern, with no new mechanism:
`recipe_translations`, `recipe_step_translations` and
`recipe_tag_translations`, each with a real FK to its parent and to
`locales(code)`, each cascading on parent delete.

The language problem the roadmap listed as open — who translates a
household's recipe — **does not exist in Phase 3**, because we write every
recipe and we write all three locales. `upsert_recipe` requires the
default locale (Spanish) and pgTAP asserts the whole catalog carries all
three. Read-time fallback to the default locale is the same `coalesce` the
ingredients module already does.

This is a temporary luxury. When users can write recipes, one
author-written locale will be all that exists, and read-time fallback will
have to resolve to *the author's* locale rather than to Spanish — noted in
§13 so it is not discovered then.

---

## 8. Seed data and the write path

Mirrors Phase 2 exactly:

| Phase 2 | Phase 3 |
|---|---|
| `data/ingredient-types.ts` | `data/recipe-types.ts` |
| `data/ingredients.ts` | `data/recipes.ts` |
| `scripts/validate-ingredients.ts` (+ test) | `scripts/validate-recipes.ts` (+ test) |
| `scripts/seed-ingredients.ts` | `scripts/seed-recipes.ts` |
| `upsert_ingredient(payload jsonb)` | `upsert_recipe(payload jsonb)` |
| `pnpm run seed:ingredients` | `pnpm run seed:recipes` |

`upsert_recipe` is one transaction per recipe spanning six tables, for the
same reason `upsert_ingredient` is: the re-seed path replaces companion
rows with a delete followed by an insert, so a failure in between must not
be able to destroy a previously-good recipe. It is also the only write
path for `recipe_nutrient_overrides` — an override is curated data like
everything else here, not a separate admin action.

**Four things it must get right, each of which is easy to leave out:**

- **Re-seeding never un-retires a recipe.** `retired_at` is preserved
  across an upsert, exactly as Phase 2 decided for ingredients. Otherwise
  re-running the seed silently resurrects everything ever withdrawn.
- **Step positions are renumbered to 1..n** from the dataset's order, so a
  gap or a duplicate in the source file cannot reach the database.
- **A step must exist in every locale the recipe has**, not merely in the
  default one. Per-step fallback would otherwise produce a recipe that is
  Catalan for four steps and Spanish for the fifth — technically valid,
  visibly broken. The same rule applies to the title.
- **Re-seeding replaces `recipe_steps` rows**, which changes their ids.
  Harmless today because step progress is client-side and keyed by
  position. It stops being harmless if progress ever becomes a stored
  row — noted here rather than in whatever future phase discovers it.

**One thing Phase 2 did not need: dependency ordering.** A recipe with a
sub-recipe line cannot be imported before the recipe it points at. The
importer topologically sorts the dataset before applying it, and fails
loudly if the *dataset itself* contains a cycle — caught in TypeScript
before anything touches the database, with the trigger from §3 as the
backstop that catches whatever the importer misses.

The validator restates the database's vocabularies as TypeScript unions
(unit codes, locale codes, nutrient codes, tag codes, ingredient codes), so
a typo is a `pnpm run typecheck` failure in CI rather than a runtime error
from the importer — the same reasoning behind `data/ingredient-types.ts`.

**Dataset size is not fixed here.** Phase 2 targeted 150–250 ingredients
and shipped 62, which was fine because the infrastructure was the
deliverable and curation continues against it. Same stance: Phase 3 ships
working machinery plus enough recipes to exercise every branch — an
ingredient-only recipe, a single-ingredient "recipe" (a piece of fruit), a
recipe with a sub-recipe, a recipe with an override, a recipe with a mass
yield and one with a count yield.

---

## 9. Build sequence

Each step is a PR, in this order, mirroring how Phase 2 was sliced:

1. **Shared-code moves** (§6) — `src/lib/text.ts` and `src/lib/nutrition/`
   out of the ingredients module. Pure relocation, no behaviour change,
   and it lands before anything depends on it.
2. **Ingredient convertibility** (§2.6) — a Phase 2 table change. Cheap
   against 62 ingredients and steadily less cheap after, which is why it
   is here and not in 3b with the roll-up it serves.
3. **Recipe schema + RLS** (§2.1–2.5, §5) — tables, constraints, policies.
4. **Invariant triggers** (§3) — units, cycles, depth, retirement.
5. **`upsert_recipe` + `set_recipe_retired`** (§8).
6. **Derived diet/allergen facts** (§4.3) — the recursive walk to leaf
   ingredients, union for allergens, intersection for diets. Ahead of the
   seed pipeline because the dataset should be checked against it.
7. **Seed pipeline** (§8) — types, validator, importer, dataset.
8. **UI** (§6, §6.1) — list with basics hidden, search by name and
   ingredient, allergen/diet filters, detail page with linked lines,
   servings scaling, tickable steps.

Steps 2–6 are testable entirely from pgTAP with no UI at all, which is
where most of this phase's risk lives.

**Phase 3b — before the catalog passes ~25 recipes** (§4):

9. **Nutrition function** — recursive totals, per-nutrient overrides,
   completeness flag.
10. **Nutrition UI** — the panel on a recipe's page, reusing
    `src/lib/nutrition/` from step 1.

Neither alters a table Phase 3 created, which is the whole reason they can
wait.

---

## 10. Testing plan

### 10.1 pgTAP — `supabase/tests/database/phase3_invariants.sql`

Every invariant in §3 gets **two** assertions: the write path accepts what
it should, and **refuses what it should not**. The Phase 2 post-build
review found three defects that had passed every existing test precisely
because nothing asked the second question.

Refusals to assert:

- A line with both `ingredient_id` and `sub_recipe_id`; a line with
  neither.
- A `quantity` of zero, negative, or null.
- An ingredient line using a unit not in that ingredient's
  `ingredient_allowed_units`.
- A sub-recipe line using a unit of a different dimension from the
  sub-recipe's yield unit.
- A self-referencing line; a two-step cycle; a three-step cycle; a
  six-level chain built downward **and** a legal 4-deep chain that a
  2-deep sub-recipe is then attached to the top of (the depth trap in §3).
- A line onto a retired ingredient; retiring an ingredient a live recipe
  uses; a line onto a retired sub-recipe; **retiring a recipe that a live
  recipe uses as a sub-recipe**.
- Re-seeding a retired recipe and asserting it is still retired.
- `upsert_recipe` with no title in any locale; with no Spanish title; with
  no lines; with a step position gap or a duplicate position.
- `insert` / `update` / `delete` on every recipe table as `authenticated`.
- `execute` on `upsert_recipe` and `set_recipe_retired` as `anon` and as
  `authenticated`.
- An `ingredient_allowed_units` row whose unit is not convertible to the
  ingredient's basis; nulling a factor that an existing allowed unit
  needs.
- Allowing a count unit on an ingredient whose `count_divisible` is null;
  nulling `count_divisible` while a count unit is allowed; setting
  `count_divisible` on an ingredient that allows no count unit.

Arithmetic assertions, against fixture recipes with hand-computed answers.
**These land with Phase 3b**, alongside the function they test — except
the last two convertibility refusals above, which belong to the constraint
and ship in Phase 3:

- Same-dimension conversion (a line in kg against `per_100g`).
- Cross-dimension via density (a line in ml against `per_100g`).
- Count via `grams_per_unit` (2 eggs).
- Count against `per_100ml` (both factors in one conversion).
- A sub-recipe line taking a fraction of a yield, including a yield stated
  in a different unit of the same dimension.
- An override replacing exactly one nutrient and leaving the rest
  computed.
- An override on a *sub*-recipe flowing upward into its parent.
- `complete = false` where a contributing ingredient lacks a nutrient, and
  the row omitted entirely where nothing contributed.

Derived-facts assertions, which ship in **Phase 3**, not 3b:

- Allergens are a union: one gluten-containing leaf makes the whole recipe
  contain gluten, including through a sub-recipe two levels down.
- Diets are an intersection: a recipe is vegan only when every leaf is,
  and one non-vegan leaf anywhere removes the label.
- A recipe whose only non-vegan ingredient sits inside a sub-recipe is
  still not vegan — the case a non-recursive implementation gets wrong.

Seed-sanity assertions: every recipe has all three locales; every recipe
has at least one line; every referenced ingredient is live; every recipe's
steps are numbered 1..n with no gaps.

### 10.2 Unit tests (vitest)

The dataset validator, the topological sort (including its cycle
detection), and the presentation helpers in `domain/`. The nutrition
arithmetic itself is SQL and is covered by pgTAP, not duplicated here.

Three that earn their own cases:

- **`domain/scaling.ts`** — the size filter is where the value is, so it
  gets the cases: a recipe with 4 indivisible eggs offers 2 and 8; the
  same recipe with **1** egg does not offer 2; a divisible count line
  halves to a fraction and stays offered; a mass-only recipe offers every
  candidate; `min_servings` removes a size the arithmetic would have
  allowed; and the identity case (target equals `servings`) returns the
  quantities untouched. Plus one assertion that no offered size ever
  produces a fractional quantity of an indivisible ingredient — the
  property the whole design exists to guarantee.
- **`domain/basics.ts`** — one line and no steps is a basic; one line
  *with* steps is not; two lines and no steps is not.
- **`min_servings`** as a pgTAP refusal too: a recipe declaring a floor
  above its own `servings`.

### 10.3 Existing CI gates

`pnpm run typecheck`, `pnpm run lint` (including the module-boundary
rule — see the two §6 proposals), `pnpm run test`, and the `db-tests`
pgTAP job.

### 10.4 Browser verification

Required — this phase ships UI. List, search and a detail page rendered in
all three locales; the step checklist ticked and confirmed to reset on
reload (that is the specified behaviour, not a bug); a recipe with a
sub-recipe line; a recipe with an incomplete nutrient showing "at least".

### 10.5 Supabase advisors

Run after the migrations land, as Phase 2 did — new tables without RLS and
functions without a pinned `search_path` are exactly what it catches.

---

## 11. Explicitly out of scope

- **The nutrition roll-up and its overrides.** Phase 3b, gated on the
  catalog staying under ~25 recipes until then (§4). The schema that makes
  it possible — required yields, convertible units — ships in Phase 3, and
  so do the derived allergen and diet facts, which are not part of this
  deferral.
- **Photos.** The first thing anyone will notice is missing, and a fair
  deferral: images need Supabase Storage, an upload path, and a
  resizing/format story, none of which exists yet.
- **A way to ask for a recipe that isn't there.** Same shape as the
  deferred ingredient-request flow, and deferred alongside it — while the
  only households are known ones, asking directly works.
- **User-written recipes.** Columns land now (§2.1), feature later (§13).
- **Collections.** A separate feature, related to recipes but not a field
  on them. Nothing in Phase 3 — not even a table.
- Photos, prep/cook times, difficulty, ratings, favourites, comments.
- **A `max_servings` ceiling.** `min_servings` exists because a pie for
  one is not a thing; a paella for forty is the same argument in the other
  direction, and it is the same one-line addition when someone hits it.
- **Hand-written serving variants.** Considered and rejected for now in
  favour of computed sizes (§6.2), on maintenance grounds rather than
  capability. A child table on `recipes` adds them later if the linear
  assumption turns out to be wrong in practice; nothing in this phase
  forecloses it.
- **Shopping-list generation** (Phase 5) and **meal plans** (Phase 4),
  both of which consume this schema.
- **Typo-tolerant search.** Same ceiling as Phase 2: matching happens in
  the application over an already-fetched set, which is correct at catalog
  size. `unaccent` plus an index is the same job as real typo tolerance,
  so both wait for whichever is needed first.
- Ingredient substitutes and subtype relationships — still deferred, and
  still not blocked by anything here.

---

## 12. Risks carried into this phase

- **Scaling offers fewer sizes than a user might expect**, and the reason
  is invisible to them: a recipe using a single egg for four people cannot
  be halved, so it offers no small size at all. That is correct and it
  will still occasionally read as a missing option. The fix, if it ever
  matters, is curation — write the small version as its own recipe.
- **`count_divisible` is a judgement per ingredient**, and a wrong one is
  quiet: marking eggs divisible would put half an egg back on screen, and
  marking onions indivisible removes sizes that were fine. It is curated
  data like every approximation in the catalog, and the seed validator is
  where a missing one gets caught.
- **`localStorage` can be absent or refused** — a private window, cleared
  site data. Every read and write is wrapped, and the step list renders
  correctly with no stored state at all; the ticks are a convenience, not
  data.
- **The Phase 3b gate is the main new risk.** Deferring the roll-up costs
  nothing in code and everything in data if the gate is missed: every
  recipe written before it exists is a recipe whose convertibility has
  never been tested end to end. The importer printing the count on every
  run is the cheapest thing that keeps it honest, and it is worth
  building even though it is three lines.
- **Nutrient completeness beyond the EU-mandatory eight.** Handled by the
  `complete` flag (§4.3) rather than solved. A recipe's vitamin figures
  will often be partial, and the UI must never present them as totals.
- **Per-100 g is unavailable for non-mass yields** (§4.2). A soup measured
  in millilitres shows per-serving only. Giving recipes their own density
  would fix it and is not worth it now.
- **Overrides are sticky by design** (§2.5). If an ingredient's data is
  corrected, recipes overriding that nutrient keep the old figure and
  nothing flags it. This is the requested behaviour; the cost is that a
  wrong override is invisible until someone looks.
- **The depth cap of 5 is a judgement, not a measurement.** It guards
  against runaway recursion, and raising it is one line.
- **Recursive SQL is the hardest thing in this phase to get right**, and
  the part with no UI to notice a mistake. Which is why §10.1 carries
  hand-computed fixtures.
- **Magic-link click-through is still unverified**, as in Phases 1 and 2.
  Unchanged by this phase, recorded so it is not forgotten.

---

## 13. The user-owned recipes migration, sketched now

Not built in Phase 3. Written down so that building it later is an
implementation rather than a redesign — and so the Phase 3 schema is not
accidentally shaped in a way that makes it impossible.

The rule to enforce is: **a recipe line may reference a sub-recipe only if
that sub-recipe is the global catalog's, or its own owner's.** Two legal
answers — which is exactly what a plain composite foreign key cannot
express. The earlier sub-recipe decision assumed household scoping, where
there was only ever one legal answer.

A sentinel scope restores it:

```sql
-- 1. Every recipe gets a scope: its owner, or the sentinel for "global".
alter table public.recipes
  add column owner_scope_id uuid not null
    generated always as
      (coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid))
    stored,
  add unique (owner_scope_id, id);

-- 2. A line carries its parent's scope, and the FK proves it matches.
alter table public.recipe_lines
  add column owner_scope_id uuid not null,
  add foreign key (owner_scope_id, recipe_id)
    references public.recipes (owner_scope_id, id),

-- 3. ...and the claimed scope of whatever it points at.
  add column sub_recipe_scope_id uuid null,
  add foreign key (sub_recipe_scope_id, sub_recipe_id)
    references public.recipes (owner_scope_id, id),
  add check (num_nonnulls(sub_recipe_id, sub_recipe_scope_id) in (0, 2)),

-- 4. Which may only ever be mine, or global.
  add check (
    sub_recipe_scope_id is null
    or sub_recipe_scope_id = owner_scope_id
    or sub_recipe_scope_id = '00000000-0000-0000-0000-000000000000'::uuid
  );
```

That is structurally impossible to violate rather than trigger-enforced,
which was the original preference. It is deferred rather than built now
because in Phase 3 every recipe is global, so every line is already
global→global and the rule is trivially satisfied — and because adding a
generated column to a catalog-sized table with no user data in it is a
safe migration, which is precisely what stops being true later.

### 13.1 How a user's recipes reach other people: subscriptions

Settled 2026-09-12, built later. **A person subscribes to another
person's recipes** — not to an individual recipe — and every recipe that
author shares then appears among the recipes available to the subscriber.

```sql
create table public.recipe_subscriptions (
  subscriber_user_id uuid not null references public.profiles (id) on delete cascade,
  author_user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at         timestamptz not null default now(),
  primary key (subscriber_user_id, author_user_id),
  check (subscriber_user_id <> author_user_id)
);
```

**Households seed subscriptions automatically.** When someone joins a
household, that household's members and the joiner become subscribed to
each other's recipes, so a family shares its cooking without anyone
administering a list. The hook goes in `accept_household_invite` and
`create_household` — both already `security definer` functions from
Phase 1, both already the single place a membership comes into existence.

**Subscriptions survive the household that created them.** If someone
leaves, the subscriptions stay and the recipes keep flowing both ways.
That is deliberate — you do not lose your sister-in-law's paella because
she moved out — and it is a known ceiling rather than a settled end state:
it means leaving a household does not revoke recipe access, so an explicit
unsubscribe is what revokes it. Manual unsubscribe is therefore part of
the feature, not optional.

The select policy from §5 becomes:

```
retired_at is null
and (
  owner_user_id is null                                   -- the catalog
  or owner_user_id = (select auth.uid())                  -- mine
  or (visibility = 'shared' and exists (                  -- subscribed to
        select 1 from public.recipe_subscriptions s
        where s.subscriber_user_id = (select auth.uid())
          and s.author_user_id = recipes.owner_user_id))
)
```

**Who may create a subscription row is the actual access-control
boundary, and it is easy to miss.** The policy above grants read access to
an author's shared recipes to anyone holding a `recipe_subscriptions` row.
So if a user can insert that row for themselves against any author, then
`shared` means "readable by every signed-in user who asks" and the
`private` / `shared` distinction is the only thing left — which is not
what the word implies. Three options, in order of preference:

1. **No user-facing insert policy at all.** Subscriptions are created only
   by `accept_household_invite` and `create_household` (both already
   `security definer`), and deleted by the subscriber. Access follows from
   having shared a household, which is exactly the stated requirement, and
   there is no way to subscribe to a stranger because there is no way to
   *find* one.
2. Insert allowed where `subscriber_user_id = auth.uid()` **and** the two
   people currently share a household — self-service, still bounded.
3. Insert allowed where `subscriber_user_id = auth.uid()`, unbounded.
   This is "follow anyone", and it needs the discovery and blocking story
   from the pre-public-launch checklist before it is safe.

**Option 1 until there is a reason to move**, since the requirement as
stated — households subscribe each other automatically — needs no
user-initiated subscribe at all. Unsubscribe is a delete on your own row
(`subscriber_user_id = auth.uid()`), which is what makes leaving
revocable.

**This renames the visibility values.** `public` / `private` was written
before subscriptions existed, and `public` would now be a lie: a user's
shared recipe is visible to their subscribers, not to the world. The
values become `private` / `shared`, and a catalog recipe (no owner) is
neither — it is visible because it has no owner, not because of a flag.
The Phase 3 migration should therefore use `private` / `shared` from the
start rather than renaming a check constraint later.

**A sub-recipe may still only be the catalog's or your own — never a
subscribed author's.** This is the one place the feature has to be told
no. If a line could point at someone else's recipe, unsubscribing would
leave a recipe holding a reference to something its owner cannot read, and
its nutrition would silently change or fail. Building on someone's recipe
means copying it. The §13 composite FK above is exactly what makes that
rule structural, and it stays correct unchanged.

**Subscriptions are the module's first user-to-user surface**, so they
belong on the pre-public-launch checklist in `PLAN.md`: once strangers can
sign up, "subscribe to anyone" needs a discovery story and a way for an
author to remove a subscriber. Inside a beta of known households, neither
is needed yet.

### 13.2 Three other things that arrive with user recipes

- **Read-time locale fallback changes.** Today every recipe has all three
  locales and a missing one falls back to Spanish. A user's recipe will
  exist in one language, so fallback must resolve to the *author's*
  locale — which means storing it on the recipe.
- **Deleting a person.** `on delete restrict` currently blocks it while
  they own recipes. Whether their recipes are transferred, retired or
  deleted is a real decision, and a sibling of the Phase 1 zero-owner
  guard. Their *subscriptions* cascade away with the profile, in both
  directions — the rows are pure access grants with nothing to preserve.
- **Nothing about subscriptions lands in Phase 3.** The table is
  standalone, so creating it later is a `create table`, not a migration
  against live data — unlike `owner_user_id` and `sub_recipe_id`, which
  is why those two do land now. What Phase 3 takes from this section is
  one naming decision (`private` / `shared`) and one rule it must not
  accidentally contradict (sub-recipes stay catalog-or-own).
