-- pgTAP tests for Phase 3 slice 5: upsert_recipe and set_recipe_retired.
--
-- The catalog's only write path, so this is where "call it with what it
-- should refuse" matters most. The Phase 2 post-build review found that
-- upsert_ingredient accepted an ingredient with no name in any language,
-- because every test had only ever handed it good input.
--
-- Fixtures build their own ingredient and tag: the curated ones come from
-- the seed scripts, so a database built only from migrations - which is
-- what CI runs against - has an empty catalog.
--
-- Nothing here forces the deferred constraint triggers; slice 4's file
-- covers those. These assertions are about what the function itself
-- accepts, rejects and writes.

create extension if not exists pgtap;

begin;
select plan(22);

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p3-writer@example.test', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, alias) values
  ('00000000-0000-0000-0000-0000000000d1', 'P3 Writer');

insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_arroz', id, 'per_100g' from public.food_groups where code = 'cereales';

insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, true
from public.ingredients i, public.units u
where i.code = 'zz_arroz' and u.code = 'g';

insert into public.recipe_tags (code) values ('zz_rapido');

-- =====================================================================
-- What it accepts, and what it writes
-- =====================================================================

select lives_ok(
  $$ select public.upsert_recipe($json$
     {"code":"zz_base","servings":2,
      "yield":{"quantity":500,"unit":"g"},
      "translations":{"es":{"title":"ZZ Base"}},
      "steps":[{"es":"Uno."},{"es":"Dos."}],
      "lines":[{"ingredient":"zz_arroz","quantity":100,"unit":"g"}],
      "tags":["zz_rapido"],
      "nutrient_overrides":{"energy_kcal":900}}
     $json$::jsonb) $$,
  'a complete recipe is accepted'
);

select is(
  (select count(*) from public.recipe_lines l
   join public.recipes r on r.id = l.recipe_id where r.code = 'zz_base'),
  1::bigint,
  'its line was written'
);

select is(
  (select array_agg(s.position order by s.position)
   from public.recipe_steps s
   join public.recipes r on r.id = s.recipe_id where r.code = 'zz_base'),
  array[1, 2],
  'its steps are numbered 1..n'
);

select is(
  (select o.value from public.recipe_nutrient_overrides o
   join public.recipes r on r.id = o.recipe_id
   join public.nutrients n on n.id = o.nutrient_id
   where r.code = 'zz_base' and n.code = 'energy_kcal'),
  900::numeric,
  'its nutrient override was written'
);

select is(
  (select count(*) from public.recipe_tag_assignments a
   join public.recipes r on r.id = a.recipe_id where r.code = 'zz_base'),
  1::bigint,
  'its tag was assigned'
);

-- A one-line recipe with no steps at all is not a degenerate case, it is
-- how a basic entry - an apple, a glass of milk - is represented, and it
-- is what the browse list derives "basic" from.
select lives_ok(
  $$ select public.upsert_recipe($json$
     {"code":"zz_basic","servings":1,
      "yield":{"quantity":180,"unit":"g"},
      "translations":{"es":{"title":"ZZ Manzana"}},
      "lines":[{"ingredient":"zz_arroz","quantity":180,"unit":"g"}]}
     $json$::jsonb) $$,
  'a recipe with one line and no steps is accepted - that is a basic entry'
);

-- Re-seeding replaces companion sets wholesale: the dataset file is the
-- source of truth, so a step removed there must disappear here.
select lives_ok(
  $$ select public.upsert_recipe($json$
     {"code":"zz_base","servings":2,
      "yield":{"quantity":500,"unit":"g"},
      "translations":{"es":{"title":"ZZ Base"}},
      "steps":[{"es":"Solo uno."}],
      "lines":[{"ingredient":"zz_arroz","quantity":100,"unit":"g"}]}
     $json$::jsonb) $$,
  'a re-seed is accepted'
);

select is(
  (select count(*) from public.recipe_steps s
   join public.recipes r on r.id = s.recipe_id where r.code = 'zz_base'),
  1::bigint,
  'and replaces the companion sets rather than merging into them'
);

-- =====================================================================
-- Retirement
-- =====================================================================

select lives_ok(
  $$ select public.set_recipe_retired('zz_basic', true) $$,
  'a recipe can be retired'
);

select ok(
  (select retired_at is not null from public.recipes where code = 'zz_basic'),
  'and the timestamp is stamped'
);

-- The obligation that matters most on a re-seed: re-running the whole
-- dataset must not quietly resurrect something an admin withdrew.
select lives_ok(
  $$ select public.upsert_recipe($json$
     {"code":"zz_basic","servings":1,
      "yield":{"quantity":180,"unit":"g"},
      "translations":{"es":{"title":"ZZ Manzana"}},
      "lines":[{"ingredient":"zz_arroz","quantity":180,"unit":"g"}]}
     $json$::jsonb) $$,
  're-seeding a retired recipe is accepted'
);

select ok(
  (select retired_at is not null from public.recipes where code = 'zz_basic'),
  'and leaves it retired - a re-seed never resurrects a withdrawn recipe'
);

select throws_ok(
  $$ select public.set_recipe_retired('zz_nonexistent', true) $$,
  'P0001',
  null,
  'retiring an unknown code raises rather than silently doing nothing'
);

-- =====================================================================
-- What it must refuse
-- =====================================================================

select throws_ok(
  $$ select public.upsert_recipe('{"servings":2}'::jsonb) $$,
  'P0001',
  null,
  'a payload with no code is refused'
);

select throws_ok(
  $$ select public.upsert_recipe($json$
     {"code":"zz_bad","servings":2,
      "yield":{"quantity":500,"unit":"g"},
      "translations":{"en":{"title":"Only English"}},
      "lines":[{"ingredient":"zz_arroz","quantity":100,"unit":"g"}]}
     $json$::jsonb) $$,
  'P0001',
  null,
  'a recipe with no title in the default locale is refused'
);

-- The mixed-language trap: a recipe that is Catalan for four steps and
-- Spanish for the fifth is technically valid and visibly broken.
select throws_ok(
  $$ select public.upsert_recipe($json$
     {"code":"zz_bad","servings":2,
      "yield":{"quantity":500,"unit":"g"},
      "translations":{"es":{"title":"ZZ"},"en":{"title":"ZZ en"}},
      "steps":[{"es":"Uno.","en":"One."},{"es":"Dos."}],
      "lines":[{"ingredient":"zz_arroz","quantity":100,"unit":"g"}]}
     $json$::jsonb) $$,
  'P0001',
  null,
  'a step missing one of the locales the recipe declares is refused'
);

select throws_ok(
  $$ select public.upsert_recipe($json$
     {"code":"zz_bad","servings":2,
      "yield":{"quantity":500,"unit":"g"},
      "translations":{"es":{"title":"ZZ"}},
      "steps":[{"es":"Uno.","ca":"U."}],
      "lines":[{"ingredient":"zz_arroz","quantity":100,"unit":"g"}]}
     $json$::jsonb) $$,
  'P0001',
  null,
  'a step in a locale the recipe has no title for is refused too'
);

select throws_ok(
  $$ select public.upsert_recipe($json$
     {"code":"zz_bad","servings":2,
      "yield":{"quantity":500,"unit":"g"},
      "translations":{"es":{"title":"ZZ"}},
      "lines":[]}
     $json$::jsonb) $$,
  'P0001',
  null,
  'a recipe with no lines is refused - unlike steps, lines are what a recipe is'
);

select throws_ok(
  $$ select public.upsert_recipe($json$
     {"code":"zz_bad","servings":2,
      "yield":{"quantity":500,"unit":"g"},
      "translations":{"es":{"title":"ZZ"}},
      "lines":[{"ingredient":"zz_arroz","recipe":"zz_base","quantity":1,"unit":"g"}]}
     $json$::jsonb) $$,
  'P0001',
  null,
  'a line naming both an ingredient and a sub-recipe is refused by name, before the constraint sees it'
);

select throws_ok(
  $$ select public.upsert_recipe($json$
     {"code":"zz_bad","servings":2,
      "yield":{"quantity":500,"unit":"g"},
      "translations":{"es":{"title":"ZZ"}},
      "lines":[{"ingredient":"zz_no_such","quantity":1,"unit":"g"}]}
     $json$::jsonb) $$,
  'P0001',
  null,
  'an unresolvable ingredient code is named rather than silently dropped'
);

select throws_ok(
  $$ select public.upsert_recipe($json$
     {"code":"zz_bad","servings":2,
      "yield":{"quantity":500,"unit":"g"},
      "translations":{"es":{"title":"ZZ"}},
      "lines":[{"recipe":"zz_no_such","quantity":1,"unit":"g"}]}
     $json$::jsonb) $$,
  'P0001',
  null,
  'an unresolvable sub-recipe code is named - it must be imported first'
);

select throws_ok(
  $$ select public.upsert_recipe($json$
     {"code":"zz_bad","servings":2,
      "yield":{"quantity":500,"unit":"zz_no_such"},
      "translations":{"es":{"title":"ZZ"}},
      "lines":[{"ingredient":"zz_arroz","quantity":1,"unit":"g"}]}
     $json$::jsonb) $$,
  'P0001',
  null,
  'an unknown yield unit is refused'
);

-- =====================================================================
-- Who may call it
-- =====================================================================

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000d1','role','authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ select public.upsert_recipe('{"code":"zz_hacked"}'::jsonb) $$,
  '42501',
  null,
  'authenticated cannot call upsert_recipe at all'
);

reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
