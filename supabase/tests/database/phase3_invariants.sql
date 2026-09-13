-- pgTAP tests for Phase 3's database-level invariants.
--
-- This file grows with the phase. It currently covers slice 2: the rule
-- that every allowed unit of an ingredient must be convertible to that
-- ingredient's nutrition basis, and the rule that count_divisible is
-- answered exactly where a count unit is allowed.
--
-- Every rule is asserted twice: once that a legitimate write is accepted,
-- and once that the write it should refuse is refused. The Phase 2
-- post-build review found three defects that had passed every existing
-- test precisely because nothing asked the second question.
--
-- The plan count at the top has to be kept in step by hand: pgTAP fails
-- the run if the number of assertions does not match, which is the point -
-- it catches a block that silently stopped executing part-way.
--
-- A note on WHY every assertion is made against `set constraints all
-- immediate` rather than against the offending statement itself: both
-- rules are enforced by DEFERRABLE INITIALLY DEFERRED constraint
-- triggers, so the write itself succeeds and the check happens at commit.
-- A pgTAP run never commits - it rolls back at the end - so forcing the
-- pending triggers to fire is the only way to observe them. This is also
-- a faithful test of the real path: upsert_ingredient depends on exactly
-- this deferral, because it rewrites a parent row before replacing the
-- allowed units that decide whether the parent row is valid.
--
-- Which is why each test does all of its writing first and forces the
-- check exactly once, at the end. `SET CONSTRAINTS` sets the mode for the
-- rest of the transaction rather than flushing once, so a mid-test force
-- would make the NEXT statement raise on its own, outside any assertion,
-- and take the run down with it. The per-test savepoint puts the mode
-- back, since SET CONSTRAINTS is itself transactional.

create extension if not exists pgtap;

begin;
select plan(12);

-- Reference data (food groups, units) is seeded by migrations, so it is
-- present in any environment these migrations have been applied to.
-- Everything created here is rolled back at the end.

-- ---------------------------------------------------------------------
-- Convertibility: what the rule must accept
-- ---------------------------------------------------------------------

savepoint t1;
insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_mass_only', id, 'per_100g' from public.food_groups where code = 'frutas';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, true
from public.ingredients i, public.units u
where i.code = 'zz_mass_only' and u.code = 'g';

select lives_ok(
  'set constraints all immediate',
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

select lives_ok(
  'set constraints all immediate',
  'flour measured in tablespoons is fine once it has a density'
);
rollback to savepoint t2;

savepoint t3;
insert into public.ingredients (code, food_group_id, nutrition_basis, grams_per_unit, count_divisible)
select 'zz_count_ok', id, 'per_100g', 58, false from public.food_groups where code = 'huevos';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'unit'
from public.ingredients i, public.units u
where i.code = 'zz_count_ok' and u.code in ('g', 'unit');

select lives_ok(
  'set constraints all immediate',
  'a count-based ingredient is fine with a per-unit weight and an answer on divisibility'
);
rollback to savepoint t3;

-- ---------------------------------------------------------------------
-- Convertibility: what the rule must refuse
-- ---------------------------------------------------------------------

savepoint t4;
insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_vol_nodensity', id, 'per_100g' from public.food_groups where code = 'cereales';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'g'
from public.ingredients i, public.units u
where i.code = 'zz_vol_nodensity' and u.code in ('g', 'tbsp');

select throws_ok(
  'set constraints all immediate',
  'P0001',
  null,
  'a volume unit against a per-100-g basis is refused without a density'
);
rollback to savepoint t4;

savepoint t5;
insert into public.ingredients (code, food_group_id, nutrition_basis, count_divisible)
select 'zz_count_noweight', id, 'per_100g', true from public.food_groups where code = 'frutas';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'unit'
from public.ingredients i, public.units u
where i.code = 'zz_count_noweight' and u.code in ('g', 'unit');

select throws_ok(
  'set constraints all immediate',
  'P0001',
  null,
  'a count unit is refused without a grams_per_unit'
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

select throws_ok(
  'set constraints all immediate',
  'P0001',
  null,
  'a count unit against a per-100-ml basis is refused without a density as well'
);
rollback to savepoint t6;

-- The other direction, and the reason there are triggers on both tables:
-- the rule must not be breakable by removing the factor from an
-- ingredient whose allowed units were already settled.
savepoint t7;
insert into public.ingredients (code, food_group_id, nutrition_basis, density_g_per_ml)
select 'zz_density_removed', id, 'per_100g', 0.85 from public.food_groups where code = 'cereales';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'g'
from public.ingredients i, public.units u
where i.code = 'zz_density_removed' and u.code in ('g', 'tbsp');
update public.ingredients set density_g_per_ml = null where code = 'zz_density_removed';

select throws_ok(
  'set constraints all immediate',
  'P0001',
  null,
  'nulling the density of an ingredient that already allows a volume unit is refused'
);
rollback to savepoint t7;

-- Removing an allowed unit can only make an ingredient more convertible,
-- so there is no trigger on delete and this must stay legal.
--
-- Deliberately built with NO density, so the tbsp row makes the ingredient
-- invalid while it exists. If the check looked at the queued trigger row
-- rather than at the table's current state, this would still fail after
-- the delete - which is exactly the confusion worth pinning, since the
-- pending event for the inserted tbsp row does still fire.
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

select lives_ok(
  'set constraints all immediate',
  'removing an allowed unit is always legal - it can only reduce what must be convertible'
);
rollback to savepoint t8;

-- ---------------------------------------------------------------------
-- Divisibility: answered exactly where the question applies
-- ---------------------------------------------------------------------

savepoint t9;
insert into public.ingredients (code, food_group_id, nutrition_basis, grams_per_unit)
select 'zz_no_answer', id, 'per_100g', 58 from public.food_groups where code = 'huevos';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, u.code = 'unit'
from public.ingredients i, public.units u
where i.code = 'zz_no_answer' and u.code in ('g', 'unit');

select throws_ok(
  'set constraints all immediate',
  'P0001',
  null,
  'a count-based ingredient that does not say whether half of one is usable is refused'
);
rollback to savepoint t9;

savepoint t10;
insert into public.ingredients (code, food_group_id, nutrition_basis, count_divisible)
select 'zz_pointless_answer', id, 'per_100g', true from public.food_groups where code = 'aceite_oliva';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, true
from public.ingredients i, public.units u
where i.code = 'zz_pointless_answer' and u.code = 'g';

select throws_ok(
  'set constraints all immediate',
  'P0001',
  null,
  'answering divisibility for something nobody counts is refused'
);
rollback to savepoint t10;

-- The other direction again: allowing a count unit on an ingredient that
-- never answered the question.
savepoint t11;
insert into public.ingredients (code, food_group_id, nutrition_basis, grams_per_unit)
select 'zz_count_added_later', id, 'per_100g', 120 from public.food_groups where code = 'frutas';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, true
from public.ingredients i, public.units u
where i.code = 'zz_count_added_later' and u.code = 'g';
insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
select i.id, u.id, false
from public.ingredients i, public.units u
where i.code = 'zz_count_added_later' and u.code = 'unit';

select throws_ok(
  'set constraints all immediate',
  'P0001',
  null,
  'adding a count unit to an ingredient that never answered divisibility is refused'
);
rollback to savepoint t11;

-- ---------------------------------------------------------------------
-- The write path carries the new field
-- ---------------------------------------------------------------------

savepoint t12;
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
rollback to savepoint t12;

select * from finish();
rollback;
