-- pgTAP tests for Phase 2's database-level invariants.
--
-- This file grows with the phase. It currently covers slice 1: the global
-- reference vocabularies and the household region setting. Slice 2 will add
-- the ingredient tables and the upsert_ingredient() write path.
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
select plan(35);

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
select is(
  (select region_id from public.households where id = 910001),
  (select id from public.regions where code = 'zz_test_region'),
  'a non-member cannot change another household''s region'
);

reset role;

select * from finish();
rollback;
