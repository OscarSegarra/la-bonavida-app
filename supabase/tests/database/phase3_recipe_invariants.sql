-- pgTAP tests for Phase 3 slice 4: the recipe invariants.
--
-- Shaped the way PHASE_3_PLAN.md section 10.1 sets out, which slice 2
-- learned the hard way. Every rule is enforced by a deferrable initially
-- deferred constraint trigger, so the check runs at commit and a pgTAP run
-- never commits. Forcing the checks per test with SET CONSTRAINTS ALL
-- IMMEDIATE does not work: it changes the mode for the rest of the
-- transaction, so the next statement raises on its own, outside any
-- assertion. So:
--
--   1. The rule functions are asserted directly. They are pure reads and
--      behave identically whenever called.
--   2. The assert_* function is asserted to RAISE, which is immediate and
--      needs no deferral games - this is what pins the error paths.
--   3. has_trigger proves the wiring.
--   4. ONE end-to-end assertion, last in the file, forces a deferred check
--      so that the rules and the triggers are shown to be connected. Last,
--      because SET CONSTRAINTS leaks into everything after it.
--
-- Fixtures build their own ingredients: the 62 curated ones come from the
-- seed script, so a database built only from migrations - which is what CI
-- runs against - has an empty catalog.

create extension if not exists pgtap;

begin;
select plan(20);

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------

-- Rice: mass only, so a line in millilitres is a unit error rather than a
-- conversion problem.
insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_arroz', id, 'per_100g' from public.food_groups where code = 'cereales';

insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'g'
from public.ingredients i, public.units u
where i.code = 'zz_arroz' and u.code in ('g', 'kg');

-- Six recipes, all yielding a mass, so sub-recipe lines in g or kg agree
-- on dimension and lines in ml do not.
insert into public.recipes (code, servings, yield_quantity, yield_unit_id)
select 'zz_r' || s.n, 2, 500, (select id from public.units where code = 'g')
from generate_series(1, 6) as s(n);

-- A chain five recipes long: r1 -> r2 -> r3 -> r4 -> r5.
insert into public.recipe_lines (recipe_id, position, sub_recipe_id, quantity, unit_id)
select parent.id, 1, child.id, 100, (select id from public.units where code = 'g')
from generate_series(1, 4) as s(n)
join public.recipes parent on parent.code = 'zz_r' || s.n
join public.recipes child  on child.code  = 'zz_r' || (s.n + 1);

-- ---------------------------------------------------------------------
-- 1. Unit validity, both branches
-- ---------------------------------------------------------------------

savepoint u1;
insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 9, i.id, 200, u.id
from public.recipes r, public.ingredients i, public.units u
where r.code = 'zz_r6' and i.code = 'zz_arroz' and u.code = 'g';

select ok(
  private.recipe_line_unit_is_valid(
    (select id from public.recipe_lines where recipe_id =
      (select id from public.recipes where code = 'zz_r6') and position = 9)),
  'an ingredient line measured in one of that ingredient''s allowed units is valid'
);
rollback to savepoint u1;

savepoint u2;
insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 9, i.id, 200, u.id
from public.recipes r, public.ingredients i, public.units u
where r.code = 'zz_r6' and i.code = 'zz_arroz' and u.code = 'ml';

select ok(
  not private.recipe_line_unit_is_valid(
    (select id from public.recipe_lines where recipe_id =
      (select id from public.recipes where code = 'zz_r6') and position = 9)),
  'rice measured in millilitres is refused - ml is not one of its allowed units'
);
rollback to savepoint u2;

savepoint u3;
insert into public.recipe_lines (recipe_id, position, sub_recipe_id, quantity, unit_id)
select parent.id, 9, child.id, 2, u.id
from public.recipes parent, public.recipes child, public.units u
where parent.code = 'zz_r6' and child.code = 'zz_r1' and u.code = 'kg';

select ok(
  private.recipe_line_unit_is_valid(
    (select id from public.recipe_lines where recipe_id =
      (select id from public.recipes where code = 'zz_r6') and position = 9)),
  'a sub-recipe line in kg is valid against a yield stated in g - same dimension'
);
rollback to savepoint u3;

savepoint u4;
insert into public.recipe_lines (recipe_id, position, sub_recipe_id, quantity, unit_id)
select parent.id, 9, child.id, 200, u.id
from public.recipes parent, public.recipes child, public.units u
where parent.code = 'zz_r6' and child.code = 'zz_r1' and u.code = 'ml';

select ok(
  not private.recipe_line_unit_is_valid(
    (select id from public.recipe_lines where recipe_id =
      (select id from public.recipes where code = 'zz_r6') and position = 9)),
  'a sub-recipe line in ml is refused against a yield in g - a recipe has no density'
);
rollback to savepoint u4;

-- ---------------------------------------------------------------------
-- 2. The graph
-- ---------------------------------------------------------------------

select ok(
  private.recipe_reaches(
    (select id from public.recipes where code = 'zz_r1'),
    (select id from public.recipes where code = 'zz_r5')),
  'the end of a five-long chain is reachable from its start'
);

select ok(
  not private.recipe_reaches(
    (select id from public.recipes where code = 'zz_r5'),
    (select id from public.recipes where code = 'zz_r1')),
  'and the start is not reachable from the end - the edges have a direction'
);

select is(
  private.recipe_chain_length(
    (select id from public.recipes where code = 'zz_r5'),
    (select id from public.recipes where code = 'zz_r6')),
  6,
  'chain length counts the parent''s ancestors, not just the child''s descendants'
);

select is(
  private.recipe_chain_length(
    (select id from public.recipes where code = 'zz_r6'),
    (select id from public.recipes where code = 'zz_r1')),
  6,
  'and counts the child''s descendants from the other end, symmetrically'
);

-- ---------------------------------------------------------------------
-- 3. Retirement consistency
-- ---------------------------------------------------------------------

savepoint r1;
insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 9, i.id, 200, u.id
from public.recipes r, public.ingredients i, public.units u
where r.code = 'zz_r6' and i.code = 'zz_arroz' and u.code = 'g';

select ok(
  private.recipe_line_retirement_is_consistent(
    (select id from public.recipe_lines where recipe_id =
      (select id from public.recipes where code = 'zz_r6') and position = 9)),
  'a live recipe using a live ingredient is consistent'
);

update public.ingredients set retired_at = now() where code = 'zz_arroz';

select ok(
  not private.recipe_line_retirement_is_consistent(
    (select id from public.recipe_lines where recipe_id =
      (select id from public.recipes where code = 'zz_r6') and position = 9)),
  'a live recipe using a retired ingredient is not - the line would silently vanish'
);

update public.recipes set retired_at = now() where code = 'zz_r6';

select ok(
  private.recipe_line_retirement_is_consistent(
    (select id from public.recipe_lines where recipe_id =
      (select id from public.recipes where code = 'zz_r6') and position = 9)),
  'a retired recipe may reference a retired ingredient - nobody can see either'
);
rollback to savepoint r1;

-- ---------------------------------------------------------------------
-- 4. The assertions themselves raise
-- ---------------------------------------------------------------------
--
-- assert_recipe_line is ordinary and immediate, so these test the error
-- paths directly, with no deferral involved.

savepoint a1;
insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 9, i.id, 200, u.id
from public.recipes r, public.ingredients i, public.units u
where r.code = 'zz_r6' and i.code = 'zz_arroz' and u.code = 'ml';

select throws_ok(
  format($$ select private.assert_recipe_line(%s) $$,
    (select id from public.recipe_lines where recipe_id =
      (select id from public.recipes where code = 'zz_r6') and position = 9)),
  'P0001',
  null,
  'a line in a unit the ingredient does not allow raises'
);
rollback to savepoint a1;

savepoint a2;
insert into public.recipe_lines (recipe_id, position, sub_recipe_id, quantity, unit_id)
select child.id, 9, parent.id, 100, u.id
from public.recipes parent, public.recipes child, public.units u
where parent.code = 'zz_r1' and child.code = 'zz_r5' and u.code = 'g';

select throws_ok(
  format($$ select private.assert_recipe_line(%s) $$,
    (select id from public.recipe_lines where recipe_id =
      (select id from public.recipes where code = 'zz_r5') and position = 9)),
  'P0001',
  null,
  'closing the chain back on itself raises - that is a cycle'
);
rollback to savepoint a2;

savepoint a3;
insert into public.recipe_lines (recipe_id, position, sub_recipe_id, quantity, unit_id)
select parent.id, 9, child.id, 100, u.id
from public.recipes parent, public.recipes child, public.units u
where parent.code = 'zz_r5' and child.code = 'zz_r6' and u.code = 'g';

select throws_ok(
  format($$ select private.assert_recipe_line(%s) $$,
    (select id from public.recipe_lines where recipe_id =
      (select id from public.recipes where code = 'zz_r5') and position = 9)),
  'P0001',
  null,
  'a sixth level raises, counting the whole chain rather than what is below the new line'
);
rollback to savepoint a3;

savepoint a4;
insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 9, i.id, 200, u.id
from public.recipes r, public.ingredients i, public.units u
where r.code = 'zz_r6' and i.code = 'zz_arroz' and u.code = 'g';
update public.ingredients set retired_at = now() where code = 'zz_arroz';

select throws_ok(
  format($$ select private.assert_recipe_line(%s) $$,
    (select id from public.recipe_lines where recipe_id =
      (select id from public.recipes where code = 'zz_r6') and position = 9)),
  'P0001',
  null,
  'a live recipe referencing a retired ingredient raises'
);
rollback to savepoint a4;

-- ---------------------------------------------------------------------
-- 5. The wiring
-- ---------------------------------------------------------------------

select has_trigger(
  'public', 'recipe_lines', 'recipe_lines_valid',
  'lines are checked whenever one is written'
);
select has_trigger(
  'public', 'ingredients', 'ingredients_retirement_unused',
  'retiring an ingredient is checked against the recipes using it'
);
select has_trigger(
  'public', 'recipes', 'recipes_retirement_unused',
  'retiring a recipe is checked against the recipes using it as a sub-recipe'
);
select has_trigger(
  'public', 'ingredient_allowed_units', 'ingredient_allowed_units_still_used',
  'withdrawing an allowed unit is checked against the lines measured in it'
);

-- ---------------------------------------------------------------------
-- 6. End to end, and last, because SET CONSTRAINTS leaks
-- ---------------------------------------------------------------------

insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 9, i.id, 200, u.id
from public.recipes r, public.ingredients i, public.units u
where r.code = 'zz_r6' and i.code = 'zz_arroz' and u.code = 'ml';

select throws_ok(
  'set constraints all immediate',
  'P0001',
  null,
  'the deferred trigger genuinely refuses a bad line, not just the function nobody called'
);

select * from finish();
rollback;
