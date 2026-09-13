-- Phase 3, slice 3: the recipe catalog.
--
-- Nine tables and their RLS. Deliberately NOT in this migration: the
-- invariant triggers (cycles, depth, unit branches, retirement - slice 4)
-- and the upsert_recipe write path (slice 5). This is the shape only.
--
-- Recipes are the project's SECOND global, admin-curated exception to
-- household scoping, and it is logged as such in DECISIONS.md. The
-- justification is the one the ingredient catalog earned: there is no user
-- write path at all, so there is no cross-household data here to protect
-- and no moderation surface to design around. Every table below gets RLS
-- enabled and forced, a select policy for authenticated, and deliberately
-- NO insert, update or delete policy - with RLS forced and no policy,
-- Postgres refuses every write regardless of what the application asks.
--
-- Two columns land here for a feature that ships later, on the rule that a
-- column on a table which will hold live data is cheap now and a data
-- migration afterwards: owner_user_id/visibility (user-written recipes)
-- and recipe_lines.sub_recipe_id (a recipe used as an ingredient of
-- another). Only the shape is early; the picker UI, the nutrition roll-up
-- and the shopping-list recursion are all deferred.

-- ---------------------------------------------------------------------
-- 1. recipes
-- ---------------------------------------------------------------------

create table public.recipes (
  id             bigint generated always as identity primary key,
  code           text not null unique,
  owner_user_id  uuid null references public.profiles (id) on delete restrict,
  visibility     text not null default 'shared'
                   check (visibility in ('private', 'shared')),
  servings       integer not null check (servings > 0),
  min_servings   integer not null default 1
                   check (min_servings > 0),
  yield_quantity numeric not null check (yield_quantity > 0),
  yield_unit_id  bigint not null references public.units (id),
  retired_at     timestamptz null,
  created_at     timestamptz not null default now(),

  -- A floor above the recipe's own stated size is not a floor, it is a
  -- contradiction.
  constraint recipes_min_servings_within_servings
    check (min_servings <= servings),

  -- A catalog recipe has no owner, so it cannot be private *to* anyone.
  constraint recipes_ownerless_is_shared
    check (owner_user_id is not null or visibility = 'shared')
);

comment on table public.recipes is
'The recipe catalog. Global and admin-curated in Phase 3 - every authenticated user reads every live recipe and no user can write one - which is the project''s second logged exception to household scoping, earned the same way the ingredient catalog earned the first: there is no user write path at all.';

comment on column public.recipes.code is
'Stable identity, and what the seed dataset addresses. Never a title: titles are per-locale and change. Surrogate ids differ between environments; codes do not, which is what makes a dataset portable.';

comment on column public.recipes.owner_user_id is
'Null means a catalog recipe, owned by nobody and readable by everybody - which is every row in Phase 3. When users can write recipes, a recipe belongs to a PERSON rather than a household, and other people reach it by subscribing to that person. References profiles(id), not auth.users(id), following the Phase 1 rule that taking part in app data requires a profile.';

comment on column public.recipes.visibility is
'"shared" means visible to the people subscribed to this recipe''s owner - NOT visible to the world, which is why the value is not called "public". Inert while every recipe is a catalog recipe, and correct as written, so the policy will not need revisiting when it stops being inert.';

comment on column public.recipes.servings is
'How many people the recipe feeds. Distinct from yield_quantity, and not derivable from it: servings is what per-serving nutrition divides by, yield is what a sub-recipe line divides by.';

comment on column public.recipes.min_servings is
'The smallest size this recipe can be made at, whatever the arithmetic allows - you cannot make a pie for one. One of the two filters on which serving sizes are offered; the other is whether scaling would need half of an indivisible ingredient. Defaults to 1, so most recipes say nothing.';

comment on column public.recipes.yield_quantity is
'How much finished food the recipe makes, stated by whoever wrote it and NOT computable from the inputs: 300 g of raw rice becomes roughly 750 g cooked, because it absorbs water. A sub-recipe line takes a fraction of this.';

comment on column public.recipes.retired_at is
'Set to withdraw a recipe. Retirement rather than deletion, exactly as for ingredients: the row survives so anything already referencing it keeps resolving, while the select policy hides it from readers.';

-- ---------------------------------------------------------------------
-- 2. Translations
-- ---------------------------------------------------------------------

create table public.recipe_translations (
  recipe_id   bigint not null references public.recipes (id) on delete cascade,
  locale      text not null references public.locales (code),
  title       text not null check (length(trim(title)) > 0),
  description text null,
  primary key (recipe_id, locale)
);

comment on table public.recipe_translations is
'One row per language for a recipe''s title and description. The translation-companion-table pattern, identical to ingredient_translations: adding a language is a data insert rather than a migration, and the foreign key back to the parent is real.';

-- ---------------------------------------------------------------------
-- 3. Steps
-- ---------------------------------------------------------------------

create table public.recipe_steps (
  id        bigint generated always as identity primary key,
  recipe_id bigint not null references public.recipes (id) on delete cascade,
  position  integer not null check (position > 0),
  unique (recipe_id, position)
);

comment on table public.recipe_steps is
'A recipe''s instructions, one row per step, ordered by position. Rows rather than one block of text because the cook ticks steps off while cooking, which needs each step to have its own identity. The rejected alternative - a JSON array inside the translation row - would have let the Spanish and Catalan versions of a recipe disagree about how many steps it has, and made "step 3" mean different things in different languages. Progress is client-side only and is never stored here.';

create table public.recipe_step_translations (
  step_id bigint not null references public.recipe_steps (id) on delete cascade,
  locale  text not null references public.locales (code),
  body    text not null check (length(trim(body)) > 0),
  primary key (step_id, locale)
);

comment on table public.recipe_step_translations is
'One row per language for a step''s text. Hanging off the step rather than off the recipe is what makes the two languages structurally unable to disagree about the step count.';

-- ---------------------------------------------------------------------
-- 4. Lines
-- ---------------------------------------------------------------------

create table public.recipe_lines (
  id            bigint generated always as identity primary key,
  recipe_id     bigint not null references public.recipes (id) on delete cascade,
  position      integer not null check (position > 0),
  ingredient_id bigint null references public.ingredients (id) on delete restrict,
  sub_recipe_id bigint null references public.recipes (id) on delete restrict,
  quantity      numeric not null check (quantity > 0),
  unit_id       bigint not null references public.units (id),

  unique (recipe_id, position),

  -- Either a catalog ingredient or another recipe, never both and never
  -- neither.
  constraint recipe_lines_exactly_one_target
    check (num_nonnulls(ingredient_id, sub_recipe_id) = 1),

  -- The trivial cycle, caught by a constraint so the recursive check added
  -- in slice 4 never has to run for it.
  constraint recipe_lines_no_self_reference
    check (sub_recipe_id is distinct from recipe_id)
);

comment on table public.recipe_lines is
'What a recipe is made of. A line points at EITHER a catalog ingredient OR another recipe - cooked rice is eaten on its own and used inside other dishes - enforced by recipe_lines_exactly_one_target. A cooked recipe is deliberately never promoted into the ingredients catalog: that catalog is global reference data with no user write path, and a recipe is a different shape anyway (a yield, steps, lines, rather than nutrition per 100 g).';

comment on column public.recipe_lines.quantity is
'Always a real, positive number. There is deliberately no "to taste" line: salt is entered as grams and the wording "(adjust to taste)" belongs in the step text, which is already being written in three languages. A nullable quantity would have made every consumer - nutrition, and later the shopping list - carry a "contributes nothing" branch forever.';

comment on column public.recipe_lines.sub_recipe_id is
'Another recipe used as an ingredient of this one. The column lands in Phase 3''s first migration although the feature ships later: today it costs one nullable column, and after households have saved real recipes the same change is a data migration against live data. On delete restrict, because the normal way to withdraw a recipe is to retire it - a real delete is only possible for a recipe nothing points at.';

comment on column public.recipe_lines.unit_id is
'Validated differently per branch, in slice 4: a line naming a catalog ingredient is restricted to that ingredient''s ingredient_allowed_units, while a line naming a sub-recipe has no row there at all and must instead share a dimension with the sub-recipe''s declared yield unit.';

-- Two lines may name the same ingredient on purpose: onion at the start
-- and more at the end is a real recipe. So there is no unique constraint
-- on (recipe_id, ingredient_id) - the consequence belongs to whoever
-- consumes the lines, and Phase 5's shopping list must aggregate them into
-- one item rather than listing onion twice.

-- ---------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------
--
-- Phase 2 dropped an index as an unearned optimisation on a
-- few-thousand-row table, and that instinct is right - but these are not
-- optimisations. They back rules that run on EVERY write once slice 4
-- lands: the cycle and depth walk, "is any live recipe using this
-- ingredient?" before a retirement, and the parent lookup every read does.
-- Without them each is a sequential scan of the whole line table.

create index recipe_lines_recipe_idx
  on public.recipe_lines (recipe_id);

create index recipe_lines_sub_recipe_idx
  on public.recipe_lines (sub_recipe_id)
  where sub_recipe_id is not null;

create index recipe_lines_ingredient_idx
  on public.recipe_lines (ingredient_id)
  where ingredient_id is not null;

-- ---------------------------------------------------------------------
-- 6. Tags
-- ---------------------------------------------------------------------
--
-- For things a person decides: rapido, cena, postre, navidad. NOT for diet
-- or allergen claims, which are derived from the lines instead - a
-- hand-typed "vegan" tag can contradict the recipe's own ingredients, and
-- nothing would be able to say which one was lying.

create table public.recipe_tags (
  id   bigint generated always as identity primary key,
  code text not null unique
);

comment on table public.recipe_tags is
'The recipe tag vocabulary - rapido, cena, postre, navidad. Admin-curated like everything else here. Deliberately separate from dietary_tags: diet and allergen facts are DERIVED from a recipe''s ingredients and never hand-applied, so that a tag cannot contradict the recipe it is on.';

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

comment on table public.recipe_tag_assignments is
'Which tags a recipe carries; a recipe may have several. Named "assignments" rather than following Phase 2''s ingredient_dietary_tags convention, because the consistent name would have been recipe_recipe_tags.';

-- ---------------------------------------------------------------------
-- 7. Nutrition overrides
-- ---------------------------------------------------------------------
--
-- The table lands now; the function that reads it is Phase 3b. Nutrition
-- is computed from the lines and never stored - the ingredient seed is
-- re-runnable, so a stored sum would go stale the moment a value was
-- corrected, with nothing to show that it had. These rows are the only
-- stored numbers, and they are stored precisely because they are NOT
-- derivable.

create table public.recipe_nutrient_overrides (
  recipe_id   bigint not null references public.recipes (id) on delete cascade,
  nutrient_id bigint not null references public.nutrients (id),
  value       numeric not null check (value >= 0),
  primary key (recipe_id, nutrient_id)
);

comment on table public.recipe_nutrient_overrides is
'Per-nutrient corrections for what cooking changes. One row per nutrient worth correcting: frying changes fat and energy, and a whole-recipe override would have meant retyping thirty vitamin values to fix two. Everything without a row here keeps computing from the lines.';

comment on column public.recipe_nutrient_overrides.value is
'The TOTAL for the whole recipe as made, in the nutrient''s own measure_unit - the same basis the computed sum produces, so per-serving and per-100 g are both derived by dividing and there is one number that can be wrong. Storing per-100 g instead would have made a hand-entered measurement depend silently on yield_quantity. Deliberately sticky: if an ingredient is later corrected, this value stays, because it represents a measurement of the finished dish rather than a sum that drifted.';

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------
--
-- Read-only for everyone, writable by nobody. The only write path is
-- upsert_recipe (slice 5), a security definer function whose EXECUTE is
-- revoked from anon and authenticated and which the seed script calls
-- under the service role.
--
-- Anonymous visitors get nothing, matching Phase 2. Every companion table
-- resolves visibility through an EXISTS on its parent, so retirement and
-- ownership are enforced in exactly one place and cannot drift apart.

alter table public.recipes                   enable row level security;
alter table public.recipes                   force  row level security;
alter table public.recipe_translations       enable row level security;
alter table public.recipe_translations       force  row level security;
alter table public.recipe_steps              enable row level security;
alter table public.recipe_steps              force  row level security;
alter table public.recipe_step_translations  enable row level security;
alter table public.recipe_step_translations  force  row level security;
alter table public.recipe_lines              enable row level security;
alter table public.recipe_lines              force  row level security;
alter table public.recipe_tags               enable row level security;
alter table public.recipe_tags               force  row level security;
alter table public.recipe_tag_translations   enable row level security;
alter table public.recipe_tag_translations   force  row level security;
alter table public.recipe_tag_assignments    enable row level security;
alter table public.recipe_tag_assignments    force  row level security;
alter table public.recipe_nutrient_overrides enable row level security;
alter table public.recipe_nutrient_overrides force  row level security;

-- The owner clause is inert in Phase 3 - no user can create a recipe - but
-- it is correct as written, so this policy does not need revisiting when
-- they can. (select auth.uid()) rather than auth.uid() so the value is
-- evaluated once per query rather than once per row.
create policy recipes_select on public.recipes
  for select to authenticated
  using (
    retired_at is null
    and (owner_user_id is null or owner_user_id = (select auth.uid()))
  );

create policy recipe_translations_select on public.recipe_translations
  for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id));

create policy recipe_steps_select on public.recipe_steps
  for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id));

create policy recipe_step_translations_select on public.recipe_step_translations
  for select to authenticated
  using (exists (select 1 from public.recipe_steps s where s.id = step_id));

create policy recipe_lines_select on public.recipe_lines
  for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id));

create policy recipe_tag_assignments_select on public.recipe_tag_assignments
  for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id));

create policy recipe_nutrient_overrides_select on public.recipe_nutrient_overrides
  for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id));

-- The tag vocabulary is plain reference data, like nutrients and units:
-- readable by any authenticated user, tied to no recipe.
create policy recipe_tags_select on public.recipe_tags
  for select to authenticated
  using (true);

create policy recipe_tag_translations_select on public.recipe_tag_translations
  for select to authenticated
  using (true);
