-- pgTAP tests for Phase 3 slice 6: derived allergen and diet facts.
--
-- The asymmetry is what these tests exist for. Allergens are a UNION and
-- diets are an INTERSECTION, and getting either backwards is dangerous in
-- a different direction: a union over diets would label a recipe vegan
-- because one of its ingredients happened to be, and an intersection over
-- allergens would hide gluten unless every single ingredient contained it.
--
-- Both are asserted in both directions, and both through a sub-recipe -
-- the case a non-recursive implementation gets wrong while looking
-- perfectly correct on a flat recipe.
--
-- Fixtures build their own ingredients: the curated ones come from the
-- seed script, so a database built only from migrations - which is what CI
-- runs against - has an empty catalog. The dietary_tags vocabulary itself
-- IS seeded by a migration, so those codes are real.

create extension if not exists pgtap;

begin;
select plan(11);

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------

insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_harina', id, 'per_100g' from public.food_groups where code = 'cereales';
insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_huevo', id, 'per_100g' from public.food_groups where code = 'huevos';
insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_arroz', id, 'per_100g' from public.food_groups where code = 'cereales';
-- Deliberately carries no dietary tags at all.
insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_sal', id, 'per_100g' from public.food_groups where code = 'limitar';

insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, true
from public.ingredients i, public.units u
where i.code in ('zz_harina', 'zz_huevo', 'zz_arroz', 'zz_sal') and u.code = 'g';

-- Flour: gluten, and suitable for both diets.
insert into public.ingredient_dietary_tags (ingredient_id, tag_id)
select i.id, t.id from public.ingredients i, public.dietary_tags t
where i.code = 'zz_harina' and t.code in ('gluten', 'vegetarian', 'vegan');

-- Egg: vegetarian but NOT vegan, which is what makes the intersection
-- observable.
insert into public.ingredient_dietary_tags (ingredient_id, tag_id)
select i.id, t.id from public.ingredients i, public.dietary_tags t
where i.code = 'zz_huevo' and t.code in ('eggs', 'vegetarian');

insert into public.ingredient_dietary_tags (ingredient_id, tag_id)
select i.id, t.id from public.ingredients i, public.dietary_tags t
where i.code = 'zz_arroz' and t.code in ('vegetarian', 'vegan');

insert into public.recipes (code, servings, yield_quantity, yield_unit_id)
select c, 2, 500, (select id from public.units where code = 'g')
from unnest(array['zz_vegan', 'zz_noveg', 'zz_parent', 'zz_plain', 'zz_untagged']) as c;

-- zz_vegan: flour + rice. Both vegan, one carries gluten.
insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 1, i.id, 100, (select id from public.units where code = 'g')
from public.recipes r, public.ingredients i
where r.code = 'zz_vegan' and i.code = 'zz_harina';
insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 2, i.id, 100, (select id from public.units where code = 'g')
from public.recipes r, public.ingredients i
where r.code = 'zz_vegan' and i.code = 'zz_arroz';

-- zz_noveg: flour + egg. Vegetarian, not vegan, two different allergens.
insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 1, i.id, 100, (select id from public.units where code = 'g')
from public.recipes r, public.ingredients i
where r.code = 'zz_noveg' and i.code = 'zz_harina';
insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 2, i.id, 60, (select id from public.units where code = 'g')
from public.recipes r, public.ingredients i
where r.code = 'zz_noveg' and i.code = 'zz_huevo';

-- zz_parent: rice, plus zz_noveg as a sub-recipe. Everything interesting
-- about it is one level down.
insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 1, i.id, 100, (select id from public.units where code = 'g')
from public.recipes r, public.ingredients i
where r.code = 'zz_parent' and i.code = 'zz_arroz';
insert into public.recipe_lines (recipe_id, position, sub_recipe_id, quantity, unit_id)
select parent.id, 2, child.id, 200, (select id from public.units where code = 'g')
from public.recipes parent, public.recipes child
where parent.code = 'zz_parent' and child.code = 'zz_noveg';

-- zz_plain: rice only.
insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 1, i.id, 200, (select id from public.units where code = 'g')
from public.recipes r, public.ingredients i
where r.code = 'zz_plain' and i.code = 'zz_arroz';

-- zz_untagged: salt only, which carries nothing.
insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 1, i.id, 5, (select id from public.units where code = 'g')
from public.recipes r, public.ingredients i
where r.code = 'zz_untagged' and i.code = 'zz_sal';

-- ---------------------------------------------------------------------
-- Allergens are a union
-- ---------------------------------------------------------------------

select ok(
  exists (select 1 from public.recipe_dietary_facts(
    (select id from public.recipes where code = 'zz_vegan')) where code = 'gluten'),
  'one gluten-containing ingredient makes the whole recipe contain gluten'
);

select is(
  (select count(*) from public.recipe_dietary_facts(
    (select id from public.recipes where code = 'zz_noveg')) where category = 'allergen'),
  2::bigint,
  'two ingredients with different allergens contribute both, not their overlap'
);

select ok(
  not exists (select 1 from public.recipe_dietary_facts(
    (select id from public.recipes where code = 'zz_plain')) where category = 'allergen'),
  'a recipe whose ingredients carry no allergens carries none'
);

-- ---------------------------------------------------------------------
-- Diets are an intersection
-- ---------------------------------------------------------------------

select ok(
  exists (select 1 from public.recipe_dietary_facts(
    (select id from public.recipes where code = 'zz_vegan')) where code = 'vegan'),
  'a recipe is vegan when every ingredient is'
);

select ok(
  not exists (select 1 from public.recipe_dietary_facts(
    (select id from public.recipes where code = 'zz_noveg')) where code = 'vegan'),
  'and stops being vegan the moment one ingredient is not'
);

select ok(
  exists (select 1 from public.recipe_dietary_facts(
    (select id from public.recipes where code = 'zz_noveg')) where code = 'vegetarian'),
  'while still being vegetarian, because every ingredient is'
);

-- ---------------------------------------------------------------------
-- Through a sub-recipe: the case a flat implementation gets wrong
-- ---------------------------------------------------------------------

select is(
  (select count(*) from private.recipe_leaf_ingredients(
    (select id from public.recipes where code = 'zz_parent'))),
  3::bigint,
  'the walk reaches every leaf ingredient, including those inside a sub-recipe'
);

select ok(
  exists (select 1 from public.recipe_dietary_facts(
    (select id from public.recipes where code = 'zz_parent')) where code = 'eggs'),
  'an allergen hidden inside a sub-recipe still surfaces on the parent'
);

select ok(
  not exists (select 1 from public.recipe_dietary_facts(
    (select id from public.recipes where code = 'zz_parent')) where code = 'vegan'),
  'and a non-vegan ingredient inside a sub-recipe still removes the label'
);

-- ---------------------------------------------------------------------
-- The vacuous-truth trap
-- ---------------------------------------------------------------------

select ok(
  not exists (select 1 from public.recipe_dietary_facts(
    (select id from public.recipes where code = 'zz_untagged')) where category = 'diet'),
  'a recipe whose ingredients carry no diet tags satisfies no diet'
);

select is(
  (select count(*) from public.recipe_dietary_facts(
    (select id from public.recipes where code = 'zz_untagged'))),
  0::bigint,
  'and carries no facts at all rather than vacuously satisfying everything'
);

select * from finish();
rollback;
