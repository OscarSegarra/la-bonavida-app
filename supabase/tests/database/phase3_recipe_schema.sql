-- pgTAP tests for Phase 3 slice 3: the recipe catalog's shape and access.
--
-- A separate file from phase3_invariants.sql on purpose: that one covers
-- the ingredient rules from slice 2, this one the recipe tables, and the
-- two were built on parallel branches. `supabase test db` runs every file
-- in this directory, so splitting costs nothing and avoids two branches
-- editing the same file.
--
-- Covers what slice 3 actually ships - the constraints and the RLS. The
-- invariant triggers (cycles, depth, unit branches, retirement) are slice
-- 4 and will be asserted alongside them.
--
-- Every constraint is asserted by the write it must refuse. The Phase 2
-- post-build review found three defects that had passed every existing
-- test precisely because nothing asked that question.
--
-- On what "cannot write" looks like under RLS, because the cases differ
-- and testing them identically would produce false confidence:
--   INSERT with no policy        -> raises 42501
--   UPDATE/DELETE with no policy -> matches zero rows, raises NOTHING
--   SELECT with no policy        -> returns zero rows, raises nothing
-- So inserts are asserted with throws_ok, and updates and deletes by
-- observing from outside that nothing changed.

create extension if not exists pgtap;

begin;
select plan(24);

-- ---------------------------------------------------------------------
-- Fixtures, as the superuser (which bypasses RLS; constraints still bite)
-- ---------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p3-reader@example.test', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, alias) values
  ('00000000-0000-0000-0000-0000000000c1', 'P3 Reader');

-- An ingredient of our own rather than one from the seed dataset: the 62
-- curated ingredients are loaded by `pnpm run seed:ingredients` against a
-- real environment, so a database built only from migrations - which is
-- what CI runs against - has an empty catalog. A fixture that assumed
-- otherwise would silently insert nothing and take every count assertion
-- below down with it.
insert into public.ingredients (code, food_group_id, nutrition_basis)
select 'zz_arroz', id, 'per_100g' from public.food_groups where code = 'cereales';

-- One live recipe and one retired one, so every visibility assertion has
-- both halves available.
insert into public.recipes (code, servings, yield_quantity, yield_unit_id)
select 'zz_live', 4, 750, id from public.units where code = 'g';

insert into public.recipes (code, servings, yield_quantity, yield_unit_id, retired_at)
select 'zz_retired', 2, 300, id, now() from public.units where code = 'g';

insert into public.recipe_translations (recipe_id, locale, title)
select r.id, 'es', 'ZZ Receta viva' from public.recipes r where r.code = 'zz_live';

insert into public.recipe_translations (recipe_id, locale, title)
select r.id, 'es', 'ZZ Receta retirada' from public.recipes r where r.code = 'zz_retired';

insert into public.recipe_steps (recipe_id, position)
select r.id, 1 from public.recipes r where r.code = 'zz_live';

insert into public.recipe_step_translations (step_id, locale, body)
select s.id, 'es', 'Paso uno.'
from public.recipe_steps s
join public.recipes r on r.id = s.recipe_id
where r.code = 'zz_live';

insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 1, i.id, 200, u.id
from public.recipes r, public.ingredients i, public.units u
where r.code = 'zz_live' and i.code = 'zz_arroz' and u.code = 'g';

insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
select r.id, 1, i.id, 100, u.id
from public.recipes r, public.ingredients i, public.units u
where r.code = 'zz_retired' and i.code = 'zz_arroz' and u.code = 'g';

insert into public.recipe_tags (code) values ('zz_rapido');
insert into public.recipe_tag_translations (tag_id, locale, name)
select id, 'es', 'ZZ Rápido' from public.recipe_tags where code = 'zz_rapido';

-- =====================================================================
-- Constraints: what the shape must refuse
-- =====================================================================

select throws_ok(
  $$ insert into public.recipe_lines (recipe_id, position, ingredient_id, sub_recipe_id, quantity, unit_id)
     select r.id, 90, i.id, r.id, 1, u.id
     from public.recipes r, public.ingredients i, public.units u
     where r.code = 'zz_live' and i.code = 'zz_arroz' and u.code = 'g' $$,
  '23514',
  null,
  'a line naming both an ingredient and a sub-recipe is refused'
);

select throws_ok(
  $$ insert into public.recipe_lines (recipe_id, position, quantity, unit_id)
     select r.id, 91, 1, u.id
     from public.recipes r, public.units u
     where r.code = 'zz_live' and u.code = 'g' $$,
  '23514',
  null,
  'a line naming neither an ingredient nor a sub-recipe is refused'
);

select throws_ok(
  $$ insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
     select r.id, 92, i.id, 0, u.id
     from public.recipes r, public.ingredients i, public.units u
     where r.code = 'zz_live' and i.code = 'zz_arroz' and u.code = 'g' $$,
  '23514',
  null,
  'a line with a quantity of zero is refused - there is no "to taste"'
);

select throws_ok(
  $$ insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
     select r.id, 93, i.id, -5, u.id
     from public.recipes r, public.ingredients i, public.units u
     where r.code = 'zz_live' and i.code = 'zz_arroz' and u.code = 'g' $$,
  '23514',
  null,
  'a line with a negative quantity is refused'
);

select throws_ok(
  $$ insert into public.recipe_lines (recipe_id, position, sub_recipe_id, quantity, unit_id)
     select r.id, 94, r.id, 1, u.id
     from public.recipes r, public.units u
     where r.code = 'zz_live' and u.code = 'g' $$,
  '23514',
  null,
  'a recipe cannot be its own sub-recipe'
);

select throws_ok(
  $$ insert into public.recipes (code, servings, min_servings, yield_quantity, yield_unit_id)
     select 'zz_floor_too_high', 4, 6, 750, id from public.units where code = 'g' $$,
  '23514',
  null,
  'a minimum size above the recipe''s own servings is refused'
);

select throws_ok(
  $$ insert into public.recipes (code, visibility, servings, yield_quantity, yield_unit_id)
     select 'zz_private_ownerless', 'private', 4, 750, id from public.units where code = 'g' $$,
  '23514',
  null,
  'a recipe with no owner cannot be private - there is nobody to be private to'
);

select throws_ok(
  $$ insert into public.recipes (code, servings, yield_quantity, yield_unit_id)
     select 'zz_no_servings', 0, 750, id from public.units where code = 'g' $$,
  '23514',
  null,
  'a recipe serving nobody is refused'
);

select throws_ok(
  $$ insert into public.recipe_steps (recipe_id, position)
     select r.id, 1 from public.recipes r where r.code = 'zz_live' $$,
  '23505',
  null,
  'two steps cannot share a position within one recipe'
);

select throws_ok(
  $$ insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
     select r.id, 1, i.id, 50, u.id
     from public.recipes r, public.ingredients i, public.units u
     where r.code = 'zz_live' and i.code = 'zz_arroz' and u.code = 'g' $$,
  '23505',
  null,
  'two lines cannot share a position within one recipe'
);

select throws_ok(
  $$ insert into public.recipe_translations (recipe_id, locale, title)
     select r.id, 'en', '   ' from public.recipes r where r.code = 'zz_live' $$,
  '23514',
  null,
  'a blank title is refused, not stored as whitespace'
);

select throws_ok(
  $$ insert into public.recipe_step_translations (step_id, locale, body)
     select s.id, 'en', '' from public.recipe_steps s
     join public.recipes r on r.id = s.recipe_id where r.code = 'zz_live' $$,
  '23514',
  null,
  'a blank step body is refused'
);

-- =====================================================================
-- Access control: readable by any signed-in user, writable by nobody
-- =====================================================================

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000c1','role','authenticated')::text, true);
set local role authenticated;

select ok(
  exists (select 1 from public.recipes where code = 'zz_live'),
  'authenticated can read a live recipe'
);

select ok(
  not exists (select 1 from public.recipes where code = 'zz_retired'),
  'a retired recipe is invisible, which is what makes retirement safe'
);

-- The companion tables carry no retirement column of their own: they
-- resolve visibility through their parent, so this is the assertion that
-- the single-place design actually holds.
select is(
  (select count(*) from public.recipe_translations),
  1::bigint,
  'only the live recipe''s translations are visible'
);

select is(
  (select count(*) from public.recipe_lines),
  1::bigint,
  'only the live recipe''s lines are visible'
);

select ok(
  exists (select 1 from public.recipe_steps),
  'the live recipe''s steps are visible'
);

select ok(
  exists (select 1 from public.recipe_tags where code = 'zz_rapido'),
  'the tag vocabulary is plain reference data and readable'
);

select throws_ok(
  $$ insert into public.recipes (code, servings, yield_quantity, yield_unit_id)
     select 'zz_hacked', 1, 1, id from public.units where code = 'g' $$,
  '42501',
  null,
  'authenticated cannot create a recipe'
);

select throws_ok(
  $$ insert into public.recipe_lines (recipe_id, position, ingredient_id, quantity, unit_id)
     select r.id, 50, i.id, 1, u.id
     from public.recipes r, public.ingredients i, public.units u
     where r.code = 'zz_live' and i.code = 'zz_arroz' and u.code = 'g' $$,
  '42501',
  null,
  'authenticated cannot add a line to a recipe'
);

-- No update or delete policy means these match zero rows and raise
-- nothing, so the assertion has to be made from outside.
update public.recipes set servings = 99 where code = 'zz_live';
delete from public.recipe_lines;

select set_config('request.jwt.claims', '', true);
set local role anon;

select is(
  (select count(*) from public.recipes),
  0::bigint,
  'anonymous visitors see no recipes at all'
);

select is(
  (select count(*) from public.recipe_tags),
  0::bigint,
  'anonymous visitors see no tag vocabulary either'
);

reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select servings from public.recipes where code = 'zz_live'),
  4,
  'the update by authenticated changed nothing'
);

select is(
  (select count(*) from public.recipe_lines),
  2::bigint,
  'the delete by authenticated removed nothing'
);

select * from finish();
rollback;
