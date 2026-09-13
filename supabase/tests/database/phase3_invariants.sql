-- pgTAP tests for Phase 3's database-level invariants.
--
-- This file grows with the phase. It currently covers slice 2: the rule
-- that every allowed unit of an ingredient must be convertible to that
-- ingredient's nutrition basis, and the rule that count_divisible is
-- answered exactly where a count unit is allowed.
--
-- Every rule is asserted twice: once that a legitimate arrangement is
-- accepted, and once that the arrangement it should refuse is refused.
-- The Phase 2 post-build review found three defects that had passed every
-- existing test precisely because nothing asked the second question.
--
-- The plan count at the top has to be kept in step by hand: pgTAP fails
-- the run if the number of assertions does not match, which is the point -
-- it catches a block that silently stopped executing part-way.
--
-- HOW THESE TESTS ARE SHAPED, AND WHY.
--
-- Both rules are enforced by DEFERRABLE INITIALLY DEFERRED constraint
-- triggers, so a write succeeds and the check happens at commit. A pgTAP
-- run never commits - it rolls back at the end - so the obvious approach
-- is to force the pending triggers with SET CONSTRAINTS ALL IMMEDIATE.
-- A first version did exactly that, once per test, and was wrong: SET
-- CONSTRAINTS changes the mode for the remainder of the transaction
-- rather than flushing once, so every statement after the first force
-- raised on its own, outside any assertion, and took the run down.
--
-- So the suite is built in three layers instead:
--
--   1. The rule functions are asserted directly. They hold the whole of
--      the logic, they are pure reads, and they behave identically
--      whenever they are called - which makes these the tests that
--      actually pin the behaviour.
--   2. The triggers are asserted to exist, on both tables, for both
--      rules - the wiring the first layer cannot see.
--   3. ONE end-to-end assertion, last in the file, forces the deferred
--      check and proves a bad ingredient is genuinely refused rather than
--      merely reported on by a function nobody calls. It goes last
--      precisely because SET CONSTRAINTS leaks into everything after it,
--      and nothing comes after it.

create extension if not exists pgtap;

begin;
select plan(18);

-- Reference data (food groups, units) is seeded by migrations, so it is
-- present in any environment these migrations have been applied to.
-- Everything created here is rolled back at the end. Nothing below forces
-- a deferred check until the final test, so these inserts never raise.

-- ---------------------------------------------------------------------
-- 1. Convertibility: the rule itself
-- ---------------------------------------------------------------------

savepoint t1;
insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_mass_only', id, 'per_100g' from public.food_groups where code = 'frutas';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, true
from public.ingredients i, public.units u
where i.code = 'zz_mass_only' and u.code = 'g';

select ok(
  private.ingredient_units_are_convertible(
    (select id from public.ingredients where code = 'zz_mass_only')),
  'a mass-only ingredient declared per 100 g needs no conversion factor at all'
);
rollback to savepoint t1;

savepoint t2;
insert into public.ingredients (code, food_group_id, nutrition_basis, density_g_per_ml)
select 'zz_vol_ok', id, 'per_100g', 0.53 from public.food_groups where code = 'cereales';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'g'
from public.ingredients i, public.units u
where i.code = 'zz_vol_ok' and u.code in ('g', 'tbsp');

select ok(
  private.ingredient_units_are_convertible(
    (select id from public.ingredients where code = 'zz_vol_ok')),
  'flour measured in tablespoons is convertible once it has a density'
);
rollback to savepoint t2;

savepoint t3;
insert into public.ingredients (code, food_group_id, nutrition_basis, grams_per_unit, count_divisible)
select 'zz_count_ok', id, 'per_100g', 58, false from public.food_groups where code = 'huevos';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'unit'
from public.ingredients i, public.units u
where i.code = 'zz_count_ok' and u.code in ('g', 'unit');

select ok(
  private.ingredient_units_are_convertible(
    (select id from public.ingredients where code = 'zz_count_ok')),
  'a count-based ingredient is convertible with a per-unit weight'
);
rollback to savepoint t3;

savepoint t4;
insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_vol_nodensity', id, 'per_100g' from public.food_groups where code = 'cereales';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'g'
from public.ingredients i, public.units u
where i.code = 'zz_vol_nodensity' and u.code in ('g', 'tbsp');

select ok(
  not private.ingredient_units_are_convertible(
    (select id from public.ingredients where code = 'zz_vol_nodensity')),
  'a volume unit against a per-100-g basis is not convertible without a density'
);
rollback to savepoint t4;

savepoint t5;
insert into public.ingredients (code, food_group_id, nutrition_basis, count_divisible)
select 'zz_count_noweight', id, 'per_100g', true from public.food_groups where code = 'frutas';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'unit'
from public.ingredients i, public.units u
where i.code = 'zz_count_noweight' and u.code in ('g', 'unit');

select ok(
  not private.ingredient_units_are_convertible(
    (select id from public.ingredients where code = 'zz_count_noweight')),
  'a count unit is not convertible without a grams_per_unit'
);
rollback to savepoint t5;

-- The combination nothing in the catalog reaches today, which is exactly
-- why it is worth pinning: count -> volume converts through grams, so it
-- needs the per-unit weight AND the density.
savepoint t6;
insert into public.ingredients (code, food_group_id, nutrition_basis, grams_per_unit, count_divisible)
select 'zz_count_to_volume', id, 'per_100ml', 125, true from public.food_groups where code = 'lacteos';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'ml'
from public.ingredients i, public.units u
where i.code = 'zz_count_to_volume' and u.code in ('ml', 'unit');

select ok(
  not private.ingredient_units_are_convertible(
    (select id from public.ingredients where code = 'zz_count_to_volume')),
  'a count unit against a per-100-ml basis also needs a density, not just a unit weight'
);
rollback to savepoint t6;

-- The rule must not be escapable by removing the factor from an ingredient
-- whose allowed units were already settled - which is why there is a
-- trigger on public.ingredients and not only on the units table.
savepoint t7;
insert into public.ingredients (code, food_group_id, nutrition_basis, density_g_per_ml)
select 'zz_density_removed', id, 'per_100g', 0.85 from public.food_groups where code = 'cereales';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'g'
from public.ingredients i, public.units u
where i.code = 'zz_density_removed' and u.code in ('g', 'tbsp');
update public.ingredients set density_g_per_ml = null where code = 'zz_density_removed';

select ok(
  not private.ingredient_units_are_convertible(
    (select id from public.ingredients where code = 'zz_density_removed')),
  'nulling the density of an ingredient that already allows a volume unit breaks the rule'
);
rollback to savepoint t7;

-- Removing an allowed unit can only make an ingredient more convertible,
-- so there is deliberately no trigger on delete. Built with NO density, so
-- the tbsp row makes the ingredient invalid while it exists: if the rule
-- looked at anything other than the table's current state, this would
-- still read as broken after the delete.
savepoint t8;
insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_unit_removed', id, 'per_100g' from public.food_groups where code = 'cereales';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'g'
from public.ingredients i, public.units u
where i.code = 'zz_unit_removed' and u.code in ('g', 'tbsp');
delete from public.ingredient_allowed_units
where ingredient_id = (select id from public.ingredients where code = 'zz_unit_removed')
  and unit_id = (select id from public.units where code = 'tbsp');

select ok(
  private.ingredient_units_are_convertible(
    (select id from public.ingredients where code = 'zz_unit_removed')),
  'removing the offending unit makes the ingredient convertible again'
);
rollback to savepoint t8;

-- ---------------------------------------------------------------------
-- 2. Divisibility: answered exactly where the question applies
-- ---------------------------------------------------------------------

savepoint t9;
insert into public.ingredients (code, food_group_id, nutrition_basis, grams_per_unit, count_divisible)
select 'zz_answered', id, 'per_100g', 58, false from public.food_groups where code = 'huevos';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'unit'
from public.ingredients i, public.units u
where i.code = 'zz_answered' and u.code in ('g', 'unit');

select ok(
  private.ingredient_divisibility_is_answered(
    (select id from public.ingredients where code = 'zz_answered')),
  'a count-based ingredient that says whether half of one is usable is answered'
);
rollback to savepoint t9;

savepoint t10;
insert into public.ingredients (code, food_group_id, nutrition_basis, grams_per_unit)
select 'zz_no_answer', id, 'per_100g', 58 from public.food_groups where code = 'huevos';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'unit'
from public.ingredients i, public.units u
where i.code = 'zz_no_answer' and u.code in ('g', 'unit');

select ok(
  not private.ingredient_divisibility_is_answered(
    (select id from public.ingredients where code = 'zz_no_answer')),
  'a count-based ingredient that does not say is not answered'
);
rollback to savepoint t10;

savepoint t11;
insert into public.ingredients (code, food_group_id, nutrition_basis, count_divisible)
select 'zz_pointless_answer', id, 'per_100g', true from public.food_groups where code = 'aceite_oliva';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, true
from public.ingredients i, public.units u
where i.code = 'zz_pointless_answer' and u.code = 'g';

select ok(
  not private.ingredient_divisibility_is_answered(
    (select id from public.ingredients where code = 'zz_pointless_answer')),
  'answering divisibility for something nobody counts is not valid either'
);
rollback to savepoint t11;

savepoint t12;
insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_no_count_no_answer', id, 'per_100g' from public.food_groups where code = 'aceite_oliva';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, true
from public.ingredients i, public.units u
where i.code = 'zz_no_count_no_answer' and u.code = 'g';

select ok(
  private.ingredient_divisibility_is_answered(
    (select id from public.ingredients where code = 'zz_no_count_no_answer')),
  'an ingredient nobody counts is answered by saying nothing'
);
rollback to savepoint t12;

-- ---------------------------------------------------------------------
-- 3. The write path carries the new field
-- ---------------------------------------------------------------------

savepoint t13;
select public.upsert_ingredient($json$
{
  "code": "zz_upsert_divisible",
  "food_group": "huevos",
  "nutrition_basis": "per_100g",
  "grams_per_unit": 58,
  "count_divisible": false,
  "names": { "es": "ZZ Huevo de prueba" },
  "nutrients": { "energy_kcal": 143 },
  "dietary_tags": [],
  "units": { "allowed": ["unit", "g"], "default": "unit" }
}
$json$::jsonb);

select is(
  (select count_divisible from public.ingredients where code = 'zz_upsert_divisible'),
  false,
  'upsert_ingredient writes count_divisible through to the row'
);
rollback to savepoint t13;

-- ---------------------------------------------------------------------
-- 4. The wiring: rules that nothing calls are not rules
-- ---------------------------------------------------------------------

select has_trigger(
  'public', 'ingredients', 'ingredients_units_convertible',
  'convertibility is enforced when an ingredient row changes'
);
select has_trigger(
  'public', 'ingredient_allowed_units', 'ingredient_allowed_units_convertible',
  'convertibility is enforced from the units side too'
);
select has_trigger(
  'public', 'ingredients', 'ingredients_divisibility_answered',
  'divisibility is enforced when an ingredient row changes'
);
select has_trigger(
  'public', 'ingredient_allowed_units', 'ingredient_allowed_units_divisibility_answered',
  'divisibility is enforced from the units side too'
);

-- ---------------------------------------------------------------------
-- 5. End to end, and last, because SET CONSTRAINTS leaks
-- ---------------------------------------------------------------------
--
-- Everything above proves the rules are right and that triggers exist.
-- This proves the two are actually connected: a real write of a real bad
-- ingredient is refused when the deferred check finally runs. It is the
-- final test in the file because SET CONSTRAINTS ALL IMMEDIATE changes the
-- mode for the rest of the transaction, so nothing may follow it.

insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_end_to_end', id, 'per_100g' from public.food_groups where code = 'cereales';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'g'
from public.ingredients i, public.units u
where i.code = 'zz_end_to_end' and u.code in ('g', 'tbsp');

select throws_ok(
  'set constraints all immediate',
  'P0001',
  null,
  'the deferred check actually refuses an ingredient whose units cannot be converted'
);

select * from finish();
rollback;
