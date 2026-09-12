-- pgTAP tests for Phase 2's database-level invariants.
--
-- This file grows with the phase. It currently covers slice 1 (the global
-- reference vocabularies and the household region setting) and slice 2
-- (the ingredient catalog and its five companion tables) and slice 4 (the
-- upsert_ingredient write path) and the retirement path added by the
-- post-build review, and closes with the seed-sanity invariants from plan
-- section 8.1.
--
-- The plan count at the top has to be kept in step by hand: pgTAP fails
-- the run if the number of assertions does not match, which is the point -
-- it catches a block that silently stopped executing part-way.
--
-- Run with the Supabase CLI (`supabase test db`) or pg_prove against any
-- Postgres with this project's migrations applied. Self-contained and
-- rolled back at the end - safe against a real database. Deliberately
-- avoids psql meta-commands so it runs the same way under psql, pg_prove,
-- or a programmatic SQL client.
--
-- A note on what "cannot write" looks like in RLS, because the three cases
-- differ and testing them identically would produce false confidence:
--   INSERT with no policy  -> raises "violates row-level security policy"
--   UPDATE/DELETE with no policy -> matches zero rows, raises NOTHING
--   SELECT with no policy  -> returns zero rows, raises nothing
-- So inserts are asserted with throws_ok, and updates/deletes/selects are
-- asserted by observing that nothing changed or nothing is visible.

create extension if not exists pgtap;

begin;
select plan(111);

-- Fixtures: an owner, a plain member, and a stranger, plus one household.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p2-owner@example.test',    '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p2-member@example.test',   '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p2-stranger@example.test', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, alias) values
  ('00000000-0000-0000-0000-0000000000b1', 'P2 Owner'),
  ('00000000-0000-0000-0000-0000000000b2', 'P2 Member'),
  ('00000000-0000-0000-0000-0000000000b3', 'P2 Stranger');

insert into public.households (id, name, region_id) overriding system value
  values (910001, 'P2 Household', (select id from public.regions where is_default));

insert into public.household_members (household_id, user_id, role) values
  (910001, '00000000-0000-0000-0000-0000000000b1', 'owner'),
  (910001, '00000000-0000-0000-0000-0000000000b2', 'member');

-- =====================================================================
-- Access control: readable by any signed-in user, writable by nobody.
-- This is the core security property of Phase 2.
-- =====================================================================

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b1','role','authenticated')::text, true);
set local role authenticated;

select ok((select count(*) from public.locales)      = 3,  'authenticated can read locales');
select ok((select count(*) from public.units)        = 7,  'authenticated can read units');
select ok((select count(*) from public.regions)      = 1,  'authenticated can read regions');
select ok((select count(*) from public.food_groups)  = 13, 'authenticated can read food_groups');
select ok((select count(*) from public.nutrients)    = 40, 'authenticated can read nutrients');
select ok((select count(*) from public.dietary_tags) = 16, 'authenticated can read dietary_tags');

select throws_ok(
  $$ insert into public.locales (code, name) values ('zz', 'Nope') $$,
  '42501',
  null,
  'authenticated cannot insert a locale'
);
select throws_ok(
  $$ insert into public.units (code, dimension, to_base_factor) values ('zz', 'mass', 1) $$,
  '42501',
  null,
  'authenticated cannot insert a unit'
);
select throws_ok(
  $$ insert into public.regions (code) values ('zz') $$,
  '42501',
  null,
  'authenticated cannot insert a region'
);
select throws_ok(
  $$ insert into public.food_groups (code, sort_order) values ('zz', 99) $$,
  '42501',
  null,
  'authenticated cannot insert a food group'
);
select throws_ok(
  $$ insert into public.nutrients (code, measure_unit, category, sort_order) values ('zz', 'g', 'mineral', 99) $$,
  '42501',
  null,
  'authenticated cannot insert a nutrient'
);
select throws_ok(
  $$ insert into public.dietary_tags (code, category, sort_order) values ('zz', 'diet', 99) $$,
  '42501',
  null,
  'authenticated cannot insert a dietary tag'
);

-- UPDATE and DELETE do not raise here - with no policy they simply match no
-- rows. Asserting "it threw" would pass for the wrong reason, so assert the
-- data is untouched instead.
update public.units set to_base_factor = 999 where code = 'kg';
select is(
  (select to_base_factor from public.units where code = 'kg'),
  1000::numeric,
  'an authenticated UPDATE of a reference row changes nothing (no policy matches)'
);

delete from public.dietary_tags where code = 'gluten';
select is(
  (select count(*) from public.dietary_tags),
  16::bigint,
  'an authenticated DELETE of a reference row removes nothing (no policy matches)'
);

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;

select is((select count(*) from public.locales),     0::bigint, 'anon sees no locales');
select is((select count(*) from public.food_groups), 0::bigint, 'anon sees no food groups');

reset role;

-- =====================================================================
-- Constraints
-- =====================================================================

select throws_ok(
  $$ insert into public.locales (code, name, is_default) values ('pt', 'Portugues', true) $$,
  '23505',
  null,
  'a second default locale is rejected'
);

select throws_ok(
  $$ insert into public.regions (code, is_default) values ('pt', true) $$,
  '23505',
  null,
  'a second default region is rejected'
);

select throws_ok(
  $$ insert into public.units (code, dimension, to_base_factor) values ('xx', 'length', 1) $$,
  '23514',
  null,
  'a unit with an unknown dimension is rejected'
);

select throws_ok(
  $$ insert into public.units (code, dimension, to_base_factor) values ('xx', 'mass', 0) $$,
  '23514',
  null,
  'a unit with a non-positive to_base_factor is rejected'
);

select throws_ok(
  $$ insert into public.dietary_tags (code, category, sort_order) values ('xx', 'preference', 99) $$,
  '23514',
  null,
  'a dietary tag with an unknown category is rejected'
);

-- =====================================================================
-- Seeded reference data.
--
-- The two "exactly one default" assertions are not tidiness: the partial
-- unique indexes guarantee AT MOST one, and Postgres cannot express AT
-- LEAST one. A missing default region makes create_household() fail for
-- every user, so this assertion is what protects household creation.
-- =====================================================================

select is(
  (select count(*) from public.locales where is_default),
  1::bigint,
  'exactly one locale is flagged default'
);

select is(
  (select count(*) from public.regions where is_default),
  1::bigint,
  'exactly one region is flagged default (create_household depends on it)'
);

select is(
  (select code from public.locales where is_default),
  'es',
  'the default locale is Spanish'
);

select is(
  (select code from public.regions where is_default),
  'es',
  'the default region is Spain'
);

select is(
  (select count(*) from public.nutrients where eu_mandatory),
  8::bigint,
  'eight nutrient rows are EU-mandatory (the 7 declarations, with energy as kJ and kcal)'
);

select is(
  (select count(*) from public.dietary_tags where category = 'allergen'),
  14::bigint,
  'all 14 EU Annex II allergens are present'
);

select is(
  (select count(*) from public.nutrients where category = 'vitamin'),
  13::bigint,
  'all 13 EU-listed vitamins are present'
);

-- =====================================================================
-- households.region_id
--
-- Behaviour here is INHERITED from Phase 1's owner-only households_update
-- policy rather than stated by anything in Phase 2. Inherited behaviour is
-- exactly what breaks silently when someone edits that policy for an
-- unrelated reason, so it is asserted explicitly.
-- =====================================================================

-- A second region, created here rather than in the fixtures above so the
-- reference-count assertions still see the one seeded region. Without it
-- "an owner can change the region" would be vacuous: with only Spain to
-- choose from, updating to Spain proves nothing about whether the update
-- happened at all.
insert into public.regions (code) values ('zz_test_region');

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b1','role','authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ select create_household('P2 Region Default House') $$,
  'create_household still succeeds now that region_id is not-null'
);

select is(
  (select h.region_id from public.households h where h.name = 'P2 Region Default House'),
  (select id from public.regions where is_default),
  'a new household gets the default region automatically'
);

update public.households set region_id = (select id from public.regions where code = 'zz_test_region') where id = 910001;
select is(
  (select region_id from public.households where id = 910001),
  (select id from public.regions where code = 'zz_test_region'),
  'an owner can update their household region'
);

select throws_ok(
  $$ update public.households set region_id = 999999 where id = 910001 $$,
  '23503',
  null,
  'region_id cannot be set to a region that does not exist'
);

select throws_ok(
  $$ update public.households set region_id = null where id = 910001 $$,
  '23502',
  null,
  'region_id cannot be set to null'
);

reset role;
select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b2','role','authenticated')::text, true);
set local role authenticated;

-- Again: no exception, just zero matching rows. Assert the value held.
update public.households set region_id = 999999 where id = 910001;
select is(
  (select region_id from public.households where id = 910001),
  (select id from public.regions where code = 'zz_test_region'),
  'a plain member cannot change their household region'
);

reset role;
select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b3','role','authenticated')::text, true);
set local role authenticated;

update public.households set region_id = 999999 where id = 910001;

-- Observe as superuser, NOT as the stranger. households_select requires
-- membership, so reading the row back while still acting as a non-member
-- returns no row at all and the comparison is against null - which fails
-- even though the behaviour under test is correct. (That is exactly how
-- this assertion failed on its first CI run.) The member case above does
-- not need this, because a member can legitimately see the row.
reset role;

select is(
  (select region_id from public.households where id = 910001),
  (select id from public.regions where code = 'zz_test_region'),
  'a non-member cannot change another household''s region'
);

-- =====================================================================
-- Slice 2: the ingredient catalog.
--
-- Fixtures are created as superuser. Ids are looked up by code rather
-- than forced with OVERRIDING SYSTEM VALUE, since code is the natural key
-- the rest of the system uses anyway.
-- =====================================================================

insert into public.ingredients (code, food_group_id, nutrition_basis, density_g_per_ml)
values (
  'zz_test_milk',
  (select id from public.food_groups where code = 'lacteos'),
  'per_100ml',
  1.03
);

insert into public.ingredients (code, food_group_id, nutrition_basis, grams_per_unit)
values (
  'zz_test_egg',
  (select id from public.food_groups where code = 'huevos'),
  'per_100g',
  60
);

insert into public.ingredient_translations (ingredient_id, locale, name) values
  ((select id from public.ingredients where code = 'zz_test_milk'), 'es', 'ZZ Leche'),
  ((select id from public.ingredients where code = 'zz_test_egg'),  'es', 'ZZ Huevo');

-- Both fixtures carry all eight EU-mandatory nutrients, for exactly the
-- reason the egg fixture carries units (see the note below): the
-- seed-sanity assertions at the end of this file run over every
-- ingredient present, so a fixture missing a mandatory nutrient would
-- fail the completeness assertion for the wrong reason.
--
-- Generated from the vocabulary rather than listed out, so adding a
-- mandatory nutrient to the seed later cannot silently leave these behind.
insert into public.ingredient_nutrients (ingredient_id, nutrient_id, amount)
select i.id, n.id, 1
from public.ingredients i
cross join public.nutrients n
where i.code in ('zz_test_milk', 'zz_test_egg')
  and n.eu_mandatory;

-- One real value on top, so later assertions have something meaningful to
-- read back rather than a uniform placeholder.
update public.ingredient_nutrients set amount = 3.4
 where ingredient_id = (select id from public.ingredients where code = 'zz_test_milk')
   and nutrient_id = (select id from public.nutrients where code = 'protein');

insert into public.ingredient_dietary_tags (ingredient_id, tag_id) values
  ((select id from public.ingredients where code = 'zz_test_milk'),
   (select id from public.dietary_tags where code = 'milk'));

insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default) values
  ((select id from public.ingredients where code = 'zz_test_milk'),
   (select id from public.units where code = 'ml'), true),
  ((select id from public.ingredients where code = 'zz_test_milk'),
   (select id from public.units where code = 'l'), false),
  -- The egg fixture needs units too: the seed-sanity assertions at the end
  -- of this file run over every ingredient present, so a deliberately
  -- half-built fixture would fail them for the wrong reason.
  ((select id from public.ingredients where code = 'zz_test_egg'),
   (select id from public.units where code = 'unit'), true),
  ((select id from public.ingredients where code = 'zz_test_egg'),
   (select id from public.units where code = 'g'), false);

insert into public.ingredient_seasonality (ingredient_id, region_id, month) values
  ((select id from public.ingredients where code = 'zz_test_egg'),
   (select id from public.regions where code = 'es'), 6);

-- --- access control -------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b1','role','authenticated')::text, true);
set local role authenticated;

select ok((select count(*) from public.ingredients) = 2, 'authenticated can read ingredients');
select ok(
  (select count(*) from public.ingredient_translations)
  + (select count(*) from public.ingredient_nutrients)
  + (select count(*) from public.ingredient_dietary_tags)
  + (select count(*) from public.ingredient_allowed_units)
  + (select count(*) from public.ingredient_seasonality) = 24,
  'authenticated can read every ingredient companion table'
);

select throws_ok(
  $q$ insert into public.ingredients (code, food_group_id, nutrition_basis)
     values ('zz_nope', (select id from public.food_groups where code = 'frutas'), 'per_100g') $q$,
  '42501', null, 'authenticated cannot insert an ingredient'
);
select throws_ok(
  $q$ insert into public.ingredient_translations (ingredient_id, locale, name)
     values ((select id from public.ingredients where code = 'zz_test_milk'), 'en', 'Nope') $q$,
  '42501', null, 'authenticated cannot insert an ingredient translation'
);
-- Uses a NON-mandatory nutrient on purpose. The fixture now carries all
-- eight mandatory ones, so inserting 'fat' here would also collide with
-- the primary key - and the assertion would then be passing or failing on
-- whether Postgres happens to evaluate RLS before unique indexes, which
-- is not what it is meant to be testing.
select throws_ok(
  $q$ insert into public.ingredient_nutrients (ingredient_id, nutrient_id, amount)
     values ((select id from public.ingredients where code = 'zz_test_milk'),
             (select id from public.nutrients where code = 'fibre'), 1) $q$,
  '42501', null, 'authenticated cannot insert an ingredient nutrient'
);
select throws_ok(
  $q$ insert into public.ingredient_dietary_tags (ingredient_id, tag_id)
     values ((select id from public.ingredients where code = 'zz_test_egg'),
             (select id from public.dietary_tags where code = 'eggs')) $q$,
  '42501', null, 'authenticated cannot insert an ingredient dietary tag'
);
select throws_ok(
  $q$ insert into public.ingredient_allowed_units (ingredient_id, unit_id)
     values ((select id from public.ingredients where code = 'zz_test_egg'),
             (select id from public.units where code = 'unit')) $q$,
  '42501', null, 'authenticated cannot insert an ingredient allowed unit'
);
select throws_ok(
  $q$ insert into public.ingredient_seasonality (ingredient_id, region_id, month)
     values ((select id from public.ingredients where code = 'zz_test_milk'),
             (select id from public.regions where code = 'es'), 3) $q$,
  '42501', null, 'authenticated cannot insert ingredient seasonality'
);

update public.ingredients set code = 'hijacked' where code = 'zz_test_milk';
select is(
  (select count(*) from public.ingredients where code = 'zz_test_milk'),
  1::bigint,
  'an authenticated UPDATE of an ingredient changes nothing (no policy matches)'
);

delete from public.ingredients where code = 'zz_test_egg';
select is(
  (select count(*) from public.ingredients),
  2::bigint,
  'an authenticated DELETE of an ingredient removes nothing (no policy matches)'
);

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is((select count(*) from public.ingredients), 0::bigint, 'anon sees no ingredients');
reset role;

-- --- constraints ----------------------------------------------------

select throws_ok(
  $q$ insert into public.ingredients (code, food_group_id, nutrition_basis)
     values ('zz_bad_basis', (select id from public.food_groups where code = 'frutas'), 'per_serving') $q$,
  '23514', null, 'an ingredient with an unknown nutrition_basis is rejected'
);

select throws_ok(
  $q$ insert into public.ingredients (code, food_group_id, nutrition_basis, density_g_per_ml)
     values ('zz_bad_density', (select id from public.food_groups where code = 'frutas'), 'per_100ml', 0) $q$,
  '23514', null, 'a non-positive density_g_per_ml is rejected'
);

select throws_ok(
  $q$ insert into public.ingredients (code, food_group_id, nutrition_basis, grams_per_unit)
     values ('zz_bad_gpu', (select id from public.food_groups where code = 'frutas'), 'per_100g', -1) $q$,
  '23514', null, 'a non-positive grams_per_unit is rejected'
);

select throws_ok(
  $q$ insert into public.ingredient_translations (ingredient_id, locale, name)
     values ((select id from public.ingredients where code = 'zz_test_egg'), 'en', '   ') $q$,
  '23514', null, 'a blank ingredient name is rejected'
);

select throws_ok(
  $q$ insert into public.ingredient_translations (ingredient_id, locale, name)
     values ((select id from public.ingredients where code = 'zz_test_milk'), 'es', 'Otra') $q$,
  '23505', null, 'a second translation for the same ingredient and locale is rejected'
);

select throws_ok(
  $q$ insert into public.ingredient_translations (ingredient_id, locale, name)
     values ((select id from public.ingredients where code = 'zz_test_egg'), 'es', 'zz leche') $q$,
  '23505', null, 'two ingredients cannot share a name in one locale, case-insensitively'
);

select lives_ok(
  $q$ insert into public.ingredient_translations (ingredient_id, locale, name)
     values ((select id from public.ingredients where code = 'zz_test_milk'), 'en', 'ZZ Leche') $q$,
  'the same name in two different locales is allowed'
);

-- Non-mandatory nutrient again, for the same reason: this must fail on the
-- amount, not on a primary-key collision with the fixture.
select throws_ok(
  $q$ insert into public.ingredient_nutrients (ingredient_id, nutrient_id, amount)
     values ((select id from public.ingredients where code = 'zz_test_milk'),
             (select id from public.nutrients where code = 'fibre'), -0.1) $q$,
  '23514', null, 'a negative nutrient amount is rejected'
);

select throws_ok(
  $q$ insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
     values ((select id from public.ingredients where code = 'zz_test_milk'),
             (select id from public.units where code = 'tbsp'), true) $q$,
  '23505', null, 'a second default unit for one ingredient is rejected'
);

select throws_ok(
  $q$ insert into public.ingredient_seasonality (ingredient_id, region_id, month)
     values ((select id from public.ingredients where code = 'zz_test_milk'),
             (select id from public.regions where code = 'es'), 0) $q$,
  '23514', null, 'a seasonality month of 0 is rejected'
);

select throws_ok(
  $q$ insert into public.ingredient_seasonality (ingredient_id, region_id, month)
     values ((select id from public.ingredients where code = 'zz_test_milk'),
             (select id from public.regions where code = 'es'), 13) $q$,
  '23514', null, 'a seasonality month of 13 is rejected'
);

select throws_ok(
  $q$ insert into public.ingredient_seasonality (ingredient_id, region_id, month)
     values ((select id from public.ingredients where code = 'zz_test_egg'),
             (select id from public.regions where code = 'es'), 6) $q$,
  '23505', null, 'a duplicate ingredient/region/month seasonality row is rejected'
);

select lives_ok(
  $q$ insert into public.ingredient_seasonality (ingredient_id, region_id, month)
     values ((select id from public.ingredients where code = 'zz_test_egg'),
             (select id from public.regions where code = 'zz_test_region'), 6) $q$,
  'the same ingredient and month in a different region is allowed'
);

-- --- referential integrity ------------------------------------------

select throws_ok(
  $q$ delete from public.food_groups where code = 'lacteos' $q$,
  '23503', null, 'a food group still referenced by an ingredient cannot be deleted'
);

select throws_ok(
  $q$ delete from public.units where code = 'ml' $q$,
  '23503', null, 'a unit still referenced by ingredient_allowed_units cannot be deleted'
);

select throws_ok(
  $q$ delete from public.regions where code = 'es' $q$,
  '23503', null, 'a region still referenced by ingredient_seasonality cannot be deleted'
);

select throws_ok(
  $q$ delete from public.nutrients where code = 'protein' $q$,
  '23503', null, 'a nutrient still referenced by ingredient_nutrients cannot be deleted'
);

select throws_ok(
  $q$ delete from public.dietary_tags where code = 'milk' $q$,
  '23503', null, 'a dietary tag still referenced by an ingredient cannot be deleted'
);

select throws_ok(
  $q$ delete from public.locales where code = 'es' $q$,
  '23503', null, 'a locale still referenced by an ingredient translation cannot be deleted'
);

-- Deleting the ingredient itself must take all five companion sets with
-- it. Done last, since it destroys the fixtures above.
delete from public.ingredients where code = 'zz_test_milk';
select is(
  (select count(*) from public.ingredient_translations   where ingredient_id not in (select id from public.ingredients))
  + (select count(*) from public.ingredient_nutrients    where ingredient_id not in (select id from public.ingredients))
  + (select count(*) from public.ingredient_dietary_tags where ingredient_id not in (select id from public.ingredients))
  + (select count(*) from public.ingredient_allowed_units where ingredient_id not in (select id from public.ingredients))
  + (select count(*) from public.ingredient_seasonality  where ingredient_id not in (select id from public.ingredients)),
  0::bigint,
  'deleting an ingredient cascades to all five companion tables'
);

-- =====================================================================
-- Slice 4: upsert_ingredient - the catalog's only write path.
--
-- Assertions 21-25 in the plan check the *state* seeded data ends up in;
-- these check the *transition* that produces it, which is where Phase 1's
-- orphaned-household bug actually lived.
-- =====================================================================

-- Nobody but a service role may call it. A grant here would be a write
-- path into the admin-curated catalog, defeating this phase's RLS model.
select ok(
  not has_function_privilege('authenticated', 'public.upsert_ingredient(jsonb)', 'execute'),
  'authenticated cannot execute upsert_ingredient'
);
select ok(
  not has_function_privilege('anon', 'public.upsert_ingredient(jsonb)', 'execute'),
  'anon cannot execute upsert_ingredient'
);

-- It must NOT be SECURITY DEFINER: unlike create_household it is never
-- called by an end user, so elevation would only widen the blast radius
-- of an accidental grant.
select is(
  (select prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'upsert_ingredient'),
  false,
  'upsert_ingredient is SECURITY INVOKER, not DEFINER'
);

-- Happy path: one call writes the parent row and every companion set.
--
-- The payload carries all eight EU-mandatory nutrients rather than a
-- token two. This ingredient is still present when the seed-sanity
-- assertions run at the end of the file, and one of those now requires
-- mandatory-nutrient completeness over every ingredient - so a token
-- payload would fail it for the wrong reason.
select lives_ok(
  $q$ select public.upsert_ingredient('{
    "code":"zz_up_full","food_group":"lacteos","nutrition_basis":"per_100ml",
    "density_g_per_ml":1.03,
    "names":{"es":"ZZ Completa","en":"ZZ Full"},
    "nutrients":{"energy_kj":264,"energy_kcal":63,"fat":3.6,"saturates":2.3,
                 "carbohydrate":4.7,"sugars":4.7,"protein":3.2,"salt":0.1},
    "dietary_tags":["milk","vegetarian"],
    "units":{"allowed":["ml","l"],"default":"ml"},
    "seasonality":{"es":[11,12,1]}
  }'::jsonb) $q$,
  'upsert_ingredient writes a complete ingredient in one call'
);

select is(
  (select (select count(*) from public.ingredient_translations t where t.ingredient_id = i.id)
        + (select count(*) from public.ingredient_nutrients n where n.ingredient_id = i.id)
        + (select count(*) from public.ingredient_dietary_tags d where d.ingredient_id = i.id)
        + (select count(*) from public.ingredient_allowed_units u where u.ingredient_id = i.id)
        + (select count(*) from public.ingredient_seasonality s where s.ingredient_id = i.id)
   from public.ingredients i where i.code = 'zz_up_full'),
  17::bigint,
  'every companion set landed (2 names + 8 nutrients + 2 tags + 2 units + 3 months)'
);

select is(
  (select count(*) from public.ingredient_allowed_units u
     join public.ingredients i on i.id = u.ingredient_id
    where i.code = 'zz_up_full' and u.is_default),
  1::bigint,
  'exactly one allowed unit is marked default'
);

-- Idempotency: the same code again updates in place rather than duplicating,
-- and companion sets are replaced wholesale so removals in the dataset
-- propagate.
select lives_ok(
  $q$ select public.upsert_ingredient('{
    "code":"zz_up_full","food_group":"lacteos","nutrition_basis":"per_100ml",
    "names":{"es":"ZZ Completa"},
    "nutrients":{"energy_kj":264,"energy_kcal":63,"fat":3.6,"saturates":2.3,
                 "carbohydrate":4.7,"sugars":4.7,"protein":3.2,"salt":0.1},
    "dietary_tags":["milk"],
    "units":{"allowed":["ml"],"default":"ml"},
    "seasonality":{}
  }'::jsonb) $q$,
  're-running upsert_ingredient for an existing code succeeds'
);

select is(
  (select count(*) from public.ingredients where code = 'zz_up_full'),
  1::bigint,
  're-running upsert_ingredient does not create a duplicate'
);

select is(
  (select count(*) from public.ingredient_seasonality s
     join public.ingredients i on i.id = s.ingredient_id
    where i.code = 'zz_up_full'),
  0::bigint,
  'companion rows dropped from the payload are removed, not merged'
);

-- Unresolvable codes are named rather than silently skipped. A join would
-- quietly drop them, leaving an ingredient missing data nobody noticed.
select throws_ok(
  $q$ select public.upsert_ingredient('{
    "code":"zz_up_bad","food_group":"not_a_group","nutrition_basis":"per_100g",
    "names":{"es":"X"},"nutrients":{},"dietary_tags":[],
    "units":{"allowed":["g"],"default":"g"}
  }'::jsonb) $q$,
  'P0001', null, 'an unknown food group is rejected by name'
);
select throws_ok(
  $q$ select public.upsert_ingredient('{
    "code":"zz_up_bad","food_group":"frutas","nutrition_basis":"per_100g",
    "names":{"es":"X"},"nutrients":{"not_a_nutrient":1},"dietary_tags":[],
    "units":{"allowed":["g"],"default":"g"}
  }'::jsonb) $q$,
  'P0001', null, 'an unknown nutrient code is rejected rather than dropped'
);
select throws_ok(
  $q$ select public.upsert_ingredient('{
    "code":"zz_up_bad","food_group":"frutas","nutrition_basis":"per_100g",
    "names":{"es":"X"},"nutrients":{},"dietary_tags":["not_a_tag"],
    "units":{"allowed":["g"],"default":"g"}
  }'::jsonb) $q$,
  'P0001', null, 'an unknown dietary tag is rejected rather than dropped'
);

-- "The default unit must be one of the allowed units" is a cross-column
-- rule the schema cannot express, so the function enforces it.
select throws_ok(
  $q$ select public.upsert_ingredient('{
    "code":"zz_up_bad","food_group":"frutas","nutrition_basis":"per_100g",
    "names":{"es":"X"},"nutrients":{},"dietary_tags":[],
    "units":{"allowed":["g"],"default":"kg"}
  }'::jsonb) $q$,
  'P0001', null, 'a default unit outside the allowed list is rejected'
);
select throws_ok(
  $q$ select public.upsert_ingredient('{
    "code":"zz_up_bad","food_group":"frutas","nutrition_basis":"per_100g",
    "names":{"es":"X"},"nutrients":{},"dietary_tags":[],
    "units":{"allowed":[],"default":"g"}
  }'::jsonb) $q$,
  'P0001', null, 'an ingredient with no allowed units is rejected'
);

-- An ingredient with no name is unusable rather than merely incomplete:
-- every read path resolves a display name, and with no translation rows at
-- all the fallback rule has nothing to return but a placeholder. The
-- function checked units this way from the start but never names, so a
-- payload with "names":{} wrote a complete, nameless ingredient - found by
-- calling the live function during a post-build review, not by reading it.
select throws_ok(
  $q$ select public.upsert_ingredient('{
    "code":"zz_up_bad","food_group":"frutas","nutrition_basis":"per_100g",
    "names":{},"nutrients":{},"dietary_tags":[],
    "units":{"allowed":["g"],"default":"g"}
  }'::jsonb) $q$,
  'P0001', null, 'an ingredient with no names at all is rejected'
);

-- Blank is not a name either. Without the trim, "  " would satisfy a mere
-- presence check and land a row that renders as empty space.
select throws_ok(
  $q$ select public.upsert_ingredient('{
    "code":"zz_up_bad","food_group":"frutas","nutrition_basis":"per_100g",
    "names":{"es":"   "},"nutrients":{},"dietary_tags":[],
    "units":{"allowed":["g"],"default":"g"}
  }'::jsonb) $q$,
  'P0001', null, 'an ingredient whose default-locale name is blank is rejected'
);

-- A name in some other language is not a substitute: the fallback rule
-- resolves toward the default locale, so this would still render nothing
-- for a Spanish reader.
select throws_ok(
  $q$ select public.upsert_ingredient('{
    "code":"zz_up_bad","food_group":"frutas","nutrition_basis":"per_100g",
    "names":{"en":"Only English"},"nutrients":{},"dietary_tags":[],
    "units":{"allowed":["g"],"default":"g"}
  }'::jsonb) $q$,
  'P0001', null, 'a name in a non-default locale alone is rejected'
);

-- Nothing survives a rejected call.
select is(
  (select count(*) from public.ingredients where code = 'zz_up_bad'),
  0::bigint,
  'a failed upsert_ingredient leaves no orphaned ingredients row behind'
);

-- The re-seed path is the dangerous one, and the case Phase 1 never had:
-- companion rows are deleted before being re-inserted, so without the
-- function's transaction boundary a mid-way failure would destroy a
-- previously-good name rather than merely failing to add one.
select lives_ok(
  $q$ select public.upsert_ingredient('{
    "code":"zz_up_reseed","food_group":"frutas","nutrition_basis":"per_100g",
    "names":{"es":"ZZ Buena"},
    "nutrients":{"energy_kj":209,"energy_kcal":50,"fat":0.2,"saturates":0,
                 "carbohydrate":12,"sugars":10,"protein":0.5,"salt":0},
    "dietary_tags":["vegetarian"],"units":{"allowed":["g"],"default":"g"}
  }'::jsonb) $q$,
  'seed an ingredient that a later re-seed will fail on'
);

select throws_ok(
  $q$ select public.upsert_ingredient('{
    "code":"zz_up_reseed","food_group":"frutas","nutrition_basis":"per_100g",
    "names":{"es":"ZZ Reemplazada"},"nutrients":{"not_a_nutrient":1},
    "dietary_tags":["vegetarian"],"units":{"allowed":["g"],"default":"g"}
  }'::jsonb) $q$,
  'P0001', null, 'a re-seed carrying bad data is rejected'
);

select is(
  (select t.name from public.ingredient_translations t
     join public.ingredients i on i.id = t.ingredient_id
    where i.code = 'zz_up_reseed' and t.locale = 'es'),
  'ZZ Buena',
  'a failed re-seed leaves the previous data intact rather than destroying it'
);

-- =====================================================================
-- Retirement: how an ingredient leaves the catalog.
--
-- Added after a review found there was no way to withdraw one at all. The
-- importer only ever upserts, so deleting an entry from the dataset left
-- the row live in the database forever - and by Phase 3 recipes hold a
-- foreign key to it, which makes an actual DELETE the wrong tool.
-- =====================================================================

select is(
  (select prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_ingredient_retired'),
  false,
  'set_ingredient_retired is SECURITY INVOKER, not DEFINER'
);

-- Same reasoning as upsert_ingredient, asserted the same way: granting
-- this to authenticated would hand every signed-in user the ability to
-- empty the catalog for everyone, which is precisely what this phase's
-- RLS model exists to prevent.
select ok(
  not has_function_privilege('authenticated', 'public.set_ingredient_retired(text,boolean)', 'execute'),
  'authenticated cannot execute set_ingredient_retired'
);
select ok(
  not has_function_privilege('anon', 'public.set_ingredient_retired(text,boolean)', 'execute'),
  'anon cannot execute set_ingredient_retired'
);

select lives_ok(
  $q$ select public.set_ingredient_retired('zz_test_egg', true) $q$,
  'an ingredient can be withdrawn'
);

select isnt(
  (select retired_at from public.ingredients where code = 'zz_test_egg'),
  null::timestamptz,
  'retiring stamps retired_at'
);

-- The point of the whole mechanism: the row survives, so anything already
-- referencing it still resolves, but readers stop being offered it.
select is(
  (select count(*) from public.ingredients where code = 'zz_test_egg'),
  1::bigint,
  'a retired ingredient is not deleted - the row is still there'
);

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b1','role','authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*) from public.ingredients where code = 'zz_test_egg'),
  0::bigint,
  'a retired ingredient is invisible to an authenticated reader'
);
select is(
  (select count(*) from public.ingredients where code = 'zz_test_milk'),
  1::bigint,
  'retiring one ingredient does not hide the others'
);

reset role;

-- Idempotency matters because the obvious implementation - set retired_at
-- = now() unconditionally - rewrites when it happened on every re-run,
-- destroying the one fact the timestamp exists to record.
create temp table zz_retire_stamp as
  select retired_at as original from public.ingredients where code = 'zz_test_egg';

select public.set_ingredient_retired('zz_test_egg', true);

select is(
  (select retired_at from public.ingredients where code = 'zz_test_egg'),
  (select original from zz_retire_stamp),
  're-retiring keeps the original timestamp rather than resetting it'
);

select lives_ok(
  $q$ select public.set_ingredient_retired('zz_test_egg', false) $q$,
  'a retired ingredient can be restored'
);

select is(
  (select retired_at from public.ingredients where code = 'zz_test_egg'),
  null::timestamptz,
  'restoring clears retired_at'
);

-- An unknown code is an error, not a no-op. This is called by a human
-- deciding to withdraw something, and silently doing nothing is the
-- outcome most likely to be mistaken for success.
select throws_ok(
  $q$ select public.set_ingredient_retired('zz_not_an_ingredient', true) $q$,
  'P0001', null, 'retiring an unknown code raises rather than doing nothing'
);

-- Re-seeding must never resurrect something an admin withdrew: un-retiring
-- is a deliberate act, so upsert_ingredient leaves retired_at alone.
select lives_ok(
  $q$ select public.set_ingredient_retired('zz_up_reseed', true) $q$,
  'withdraw an ingredient that a re-seed will then touch'
);

select lives_ok(
  $q$ select public.upsert_ingredient('{
    "code":"zz_up_reseed","food_group":"frutas","nutrition_basis":"per_100g",
    "names":{"es":"ZZ Buena"},
    "nutrients":{"energy_kj":209,"energy_kcal":50,"fat":0.2,"saturates":0,
                 "carbohydrate":12,"sugars":10,"protein":0.5,"salt":0},
    "dietary_tags":["vegetarian"],"units":{"allowed":["g"],"default":"g"}
  }'::jsonb) $q$,
  're-seeding a withdrawn ingredient succeeds'
);

select isnt(
  (select retired_at from public.ingredients where code = 'zz_up_reseed'),
  null::timestamptz,
  're-seeding does NOT resurrect a withdrawn ingredient'
);

select lives_ok(
  $q$ select public.set_ingredient_retired('zz_up_reseed', false) $q$,
  'restore it so the seed-sanity assertions below see the whole catalog'
);

-- =====================================================================
-- Seed sanity (plan §8.1, assertions 21-25).
--
-- These assert curation invariants the schema cannot express, over every
-- ingredient present. What that means depends on where they run, and both
-- are useful:
--   * In CI the only ingredients are this file's own fixtures, so they
--     verify the invariants hold for well-formed data.
--   * Run against preprod or prod after seeding, they check the real
--     catalog - which is the case they exist for.
--
-- They are a second line rather than the only one: the seed importer
-- enforces the same rules client-side and refuses to write a dataset that
-- breaks them, so a curation mistake is normally caught before it reaches
-- any database. These catch anything written by another route.
--
-- Placed last on purpose - earlier tests deliberately add and remove rows,
-- so this is the first point where the data is settled.
-- =====================================================================

select is(
  (select count(*) from public.ingredients i
    where not exists (
      select 1 from public.ingredient_translations t
       where t.ingredient_id = i.id
         and t.locale = (select code from public.locales where is_default)
    )),
  0::bigint,
  'every ingredient has a name in the default locale'
);

select is(
  (select count(*) from public.ingredients i
    where not exists (
      select 1 from public.ingredient_allowed_units u where u.ingredient_id = i.id
    )),
  0::bigint,
  'every ingredient has at least one allowed unit'
);

select is(
  (select count(*) from public.ingredients i
    where (select count(*) from public.ingredient_allowed_units u
            where u.ingredient_id = i.id and u.is_default) <> 1),
  0::bigint,
  'every ingredient has exactly one default unit'
);

-- Every ingredient carries every EU-mandatory nutrient.
--
-- The rest of the vocabulary is optional and sparse by design - an
-- ingredient with no known vitamins is a normal ingredient. These eight
-- are different: a declaration missing one of them is not sparse, it is
-- one no European label is allowed to print.
--
-- This was enforced by nothing at all until a review looked for it. The
-- schema cannot express it (the rule is about which rows exist, not about
-- any single row), upsert_ingredient only checks that the codes it is
-- handed resolve, and the importer's validator did not ask. All 62 seeded
-- ingredients turned out to be complete, but by curation rather than by
-- any rule - and a probe writing one with a single nutrient was accepted
-- by every layer.
--
-- Written as a count of offenders rather than a total, so a failure names
-- how many ingredients are short rather than just "a number changed".
select is(
  (select count(*) from public.ingredients i
     cross join public.nutrients n
    where n.eu_mandatory
      and not exists (
        select 1 from public.ingredient_nutrients x
         where x.ingredient_id = i.id and x.nutrient_id = n.id)),
  0::bigint,
  'every ingredient carries every EU-mandatory nutrient'
);

-- The rule from §2.3: the DEFAULT unit's dimension decides. Volume gives
-- per_100ml, mass and count both give per_100g.
--
-- "Any volume unit present" would be wrong, and this assertion is what
-- proved it: milk and olive oil are declared per 100 ml but also allow
-- grams, and allowing an extra unit must not reclassify a liquid. The
-- default unit is the ingredient's natural measure, so it is the one that
-- decides.
select is(
  (select count(*) from public.ingredients i
    where i.nutrition_basis <> (
      case (select un.dimension
              from public.ingredient_allowed_units u
              join public.units un on un.id = u.unit_id
             where u.ingredient_id = i.id and u.is_default)
        when 'volume' then 'per_100ml' else 'per_100g' end
    )),
  0::bigint,
  'every ingredient''s nutrition_basis matches its default unit''s dimension'
);

-- Without these bridging values a cross-dimension quantity is not merely
-- imprecise, it is uncomputable - so a missing one is a silent gap rather
-- than a rounding error.
select is(
  (select count(*) from public.ingredients i
    where i.density_g_per_ml is null
      and exists (select 1 from public.ingredient_allowed_units u
                    join public.units un on un.id = u.unit_id
                   where u.ingredient_id = i.id and un.dimension = 'mass')
      and exists (select 1 from public.ingredient_allowed_units u
                    join public.units un on un.id = u.unit_id
                   where u.ingredient_id = i.id and un.dimension = 'volume')),
  0::bigint,
  'every ingredient spanning mass and volume has a density'
);

select is(
  (select count(*) from public.ingredients i
    where i.grams_per_unit is null
      and exists (select 1 from public.ingredient_allowed_units u
                    join public.units un on un.id = u.unit_id
                   where u.ingredient_id = i.id and un.dimension = 'count')),
  0::bigint,
  'every ingredient allowing a count unit has a unit weight'
);

-- Every function this project owns pins its search_path.
--
-- Written as a rule over all of them rather than a check on one, because
-- the specific miss (upsert_ingredient) was found by an advisor run that
-- had been skipped - so the useful guard is the one that catches the next
-- function somebody forgets, without anyone remembering to look.
--
-- Extension-owned functions are excluded: pgtap itself installs into this
-- schema, and its search_path is not ours to set.
select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and (p.proconfig is null
           or not exists (
             select 1 from unnest(p.proconfig) c where c like 'search_path=%'))),
  0::bigint,
  'every function this project owns pins its search_path'
);

select * from finish();
rollback;
