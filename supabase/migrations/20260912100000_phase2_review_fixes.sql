-- Findings from a post-build review of Phase 2. Two things the catalog's
-- write path could not express, both found by probing the live function
-- rather than by reading it.
--
-- 1. `upsert_ingredient` accepted an ingredient with no name at all.
-- 2. There was no way to withdraw an ingredient once shipped.

-- ---------------------------------------------------------------------
-- 1. Retirement: how an ingredient leaves the catalog
-- ---------------------------------------------------------------------

-- A soft flag, not a DELETE. Phase 3 gives recipes a foreign key to
-- these rows, so deleting a mistaken ingredient would either cascade
-- into somebody's saved recipe or be blocked by the constraint - and the
-- moment we actually want is neither: "stop offering this, leave what
-- already references it intact".
--
-- Nullable timestamp rather than a boolean: "when did this leave the
-- catalog" is the question anyone debugging a missing ingredient
-- actually asks, and a boolean cannot answer it.
alter table public.ingredients
  add column retired_at timestamptz;

comment on column public.ingredients.retired_at is
'When this ingredient was withdrawn from the catalog, or NULL if it is current. Set via public.set_ingredient_retired(), never by hand. Retired ingredients stay in the table so that anything already referencing them keeps resolving; they are hidden from readers by the ingredients_select policy rather than by each query remembering to filter, so a new query cannot forget.';

-- Hiding retired rows is a policy, not a WHERE clause every caller
-- repeats. The difference matters: a filter in one query is a thing the
-- next query can forget, whereas a policy is applied by Postgres to
-- every authenticated read no matter who writes it.
--
-- The service role still sees retired rows - it holds BYPASSRLS - which
-- is what lets the seed script report on them and un-retire one.
drop policy ingredients_select on public.ingredients;
create policy ingredients_select on public.ingredients
  for select to authenticated
  using (retired_at is null);

-- Both directions in one function: retiring by mistake needs an undo,
-- and a second near-identical function would be the thing that drifts.
--
-- coalesce on the way in preserves the original retirement timestamp, so
-- re-running a retire is idempotent rather than quietly resetting when
-- it happened.
create function public.set_ingredient_retired(_code text, _retired boolean)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  _id bigint;
begin
  update public.ingredients
     set retired_at = case when _retired then coalesce(retired_at, now()) else null end
   where code = _code
  returning id into _id;

  -- An unknown code is an error rather than a no-op: this is called by a
  -- human deciding to withdraw something, and silently doing nothing is
  -- the outcome most likely to be mistaken for success.
  if _id is null then
    raise exception 'set_ingredient_retired: unknown ingredient code "%"', _code;
  end if;

  return _id;
end;
$$;

-- Same reasoning as upsert_ingredient: admin-only, so no end-user role
-- gets EXECUTE. `public` is the PUBLIC pseudo-role Postgres grants to new
-- functions by default; anon and authenticated are named so the intent is
-- legible rather than inherited.
revoke execute on function public.set_ingredient_retired(text, boolean) from public;
revoke execute on function public.set_ingredient_retired(text, boolean) from anon;
revoke execute on function public.set_ingredient_retired(text, boolean) from authenticated;

comment on function public.set_ingredient_retired(text, boolean) is
'Input: _code (text) - the ingredient''s stable slug; _retired (boolean) - true to withdraw, false to restore.
Output: bigint - the ingredient''s id.
Overview: withdraws an ingredient from the catalog without deleting it, so anything already referencing it keeps resolving, and restores it again. Retired rows are hidden from authenticated readers by the ingredients_select policy, not by a filter each query has to remember. Idempotent: re-retiring keeps the original timestamp rather than resetting it. Raises on an unknown code rather than silently doing nothing. Admin-only - EXECUTE is revoked from public/anon/authenticated, so the catalog stays as unwritable from the app as upsert_ingredient leaves it.';

-- ---------------------------------------------------------------------
-- 2. upsert_ingredient: require a name in the default locale
-- ---------------------------------------------------------------------

-- The function raised a named error for an unknown food group, nutrient,
-- dietary tag, unit or region, for zero allowed units, and for a default
-- unit outside the allowed list - but never looked at `names`. Called
-- with "names":{} it wrote a complete ingredient carrying no name in any
-- language, which every read path renders as a placeholder.
--
-- That is the same class of defect as "no allowed units", which this
-- function already rejects: not incomplete data, but a structurally
-- unusable row. The seed script's validator caught it, but the validator
-- is the outer layer - this function is the guarantee everything else is
-- written to rely on.
--
-- NOTE: the whole body has to be restated. CREATE OR REPLACE FUNCTION
-- replaces a function's SET clauses along with its body, so omitting
-- `set search_path = ''` here would silently undo the pin added in
-- 20260912070000 - the exact regression that migration exists to prevent.
create or replace function public.upsert_ingredient(payload jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  _ingredient_id bigint;
  _food_group_id bigint;
  _default_unit text;
  _allowed_units text[];
  _code text := payload ->> 'code';
  _missing text;
  _default_locale text;
begin
  if _code is null or length(trim(_code)) = 0 then
    raise exception 'upsert_ingredient: payload has no "code"';
  end if;

  select id into _food_group_id
  from public.food_groups
  where code = payload ->> 'food_group';

  if _food_group_id is null then
    raise exception 'upsert_ingredient(%): unknown food group "%"',
      _code, payload ->> 'food_group';
  end if;

  -- Checked before anything is written, so a nameless payload leaves no
  -- parent row behind. Which locale is the default is read from the
  -- table rather than hardcoded to 'es': locales.is_default is already
  -- load-bearing elsewhere, and two places disagreeing about it would be
  -- worse than one place being wrong.
  select code into _default_locale from public.locales where is_default;
  if _default_locale is null then
    raise exception 'upsert_ingredient(%): no default locale is configured', _code;
  end if;
  if coalesce(trim(payload #>> array['names', _default_locale]), '') = '' then
    raise exception 'upsert_ingredient(%): no name for the default locale "%"',
      _code, _default_locale;
  end if;

  -- Parent row. ON CONFLICT makes a re-seed an update rather than a
  -- duplicate, which is what lets the whole dataset be re-applied safely.
  --
  -- retired_at is deliberately NOT touched here. Re-running the seed must
  -- not quietly resurrect something an admin withdrew; un-retiring is an
  -- explicit act through set_ingredient_retired().
  insert into public.ingredients (
    code, food_group_id, nutrition_basis, density_g_per_ml, grams_per_unit
  )
  values (
    _code,
    _food_group_id,
    payload ->> 'nutrition_basis',
    (payload ->> 'density_g_per_ml')::numeric,
    (payload ->> 'grams_per_unit')::numeric
  )
  on conflict (code) do update set
    food_group_id    = excluded.food_group_id,
    nutrition_basis  = excluded.nutrition_basis,
    density_g_per_ml = excluded.density_g_per_ml,
    grams_per_unit   = excluded.grams_per_unit
  returning id into _ingredient_id;

  -- Companion sets are replaced wholesale rather than merged: the dataset
  -- file is the source of truth, so removing a translation or a seasonal
  -- month there must remove it here too.

  delete from public.ingredient_translations where ingredient_id = _ingredient_id;
  insert into public.ingredient_translations (ingredient_id, locale, name)
  select _ingredient_id, key, value #>> '{}'
  from jsonb_each(coalesce(payload -> 'names', '{}'::jsonb));

  delete from public.ingredient_nutrients where ingredient_id = _ingredient_id;
  insert into public.ingredient_nutrients (ingredient_id, nutrient_id, amount)
  select _ingredient_id, n.id, (value #>> '{}')::numeric
  from jsonb_each(coalesce(payload -> 'nutrients', '{}'::jsonb)) as e(key, value)
  join public.nutrients n on n.code = e.key;

  -- A nutrient code that does not resolve would otherwise be dropped by
  -- that join without a word, leaving an ingredient quietly missing data.
  select string_agg(e.key, ', ') into _missing
  from jsonb_each(coalesce(payload -> 'nutrients', '{}'::jsonb)) as e(key, value)
  where not exists (select 1 from public.nutrients n where n.code = e.key);
  if _missing is not null then
    raise exception 'upsert_ingredient(%): unknown nutrient code(s): %', _code, _missing;
  end if;

  delete from public.ingredient_dietary_tags where ingredient_id = _ingredient_id;
  insert into public.ingredient_dietary_tags (ingredient_id, tag_id)
  select _ingredient_id, t.id
  from jsonb_array_elements_text(coalesce(payload -> 'dietary_tags', '[]'::jsonb)) as tag
  join public.dietary_tags t on t.code = tag;

  select string_agg(tag, ', ') into _missing
  from jsonb_array_elements_text(coalesce(payload -> 'dietary_tags', '[]'::jsonb)) as tag
  where not exists (select 1 from public.dietary_tags t where t.code = tag);
  if _missing is not null then
    raise exception 'upsert_ingredient(%): unknown dietary tag(s): %', _code, _missing;
  end if;

  -- Units: the default must be one of the allowed ones. The schema already
  -- makes "two defaults" impossible; this catches "default is not in the
  -- allowed list", which the schema cannot express.
  _default_unit := payload #>> '{units,default}';
  select array_agg(u) into _allowed_units
  from jsonb_array_elements_text(coalesce(payload #> '{units,allowed}', '[]'::jsonb)) as u;

  if _allowed_units is null or array_length(_allowed_units, 1) is null then
    raise exception 'upsert_ingredient(%): no allowed units', _code;
  end if;
  if _default_unit is null or not (_default_unit = any(_allowed_units)) then
    raise exception 'upsert_ingredient(%): default unit "%" is not in the allowed list',
      _code, coalesce(_default_unit, '(none)');
  end if;

  select string_agg(u, ', ') into _missing
  from unnest(_allowed_units) as u
  where not exists (select 1 from public.units where code = u);
  if _missing is not null then
    raise exception 'upsert_ingredient(%): unknown unit code(s): %', _code, _missing;
  end if;

  delete from public.ingredient_allowed_units where ingredient_id = _ingredient_id;
  insert into public.ingredient_allowed_units (ingredient_id, unit_id, is_default)
  select _ingredient_id, u.id, u.code = _default_unit
  -- The unnest alias must be qualified: calling it "code" makes the join
  -- condition ambiguous against units.code, which Postgres rejects.
  from unnest(_allowed_units) as allowed(unit_code)
  join public.units u on u.code = allowed.unit_code;

  delete from public.ingredient_seasonality where ingredient_id = _ingredient_id;
  insert into public.ingredient_seasonality (ingredient_id, region_id, month)
  select _ingredient_id, r.id, m::smallint
  from jsonb_each(coalesce(payload -> 'seasonality', '{}'::jsonb)) as e(region_code, months)
  join public.regions r on r.code = e.region_code
  cross join lateral jsonb_array_elements_text(e.months) as m;

  select string_agg(e.region_code, ', ') into _missing
  from jsonb_each(coalesce(payload -> 'seasonality', '{}'::jsonb)) as e(region_code, months)
  where not exists (select 1 from public.regions r where r.code = e.region_code);
  if _missing is not null then
    raise exception 'upsert_ingredient(%): unknown region code(s): %', _code, _missing;
  end if;

  return _ingredient_id;
end;
$$;

-- CREATE OR REPLACE also drops the privileges the previous definition was
-- left with, so the revokes have to be restated alongside it.
revoke execute on function public.upsert_ingredient(jsonb) from public;
revoke execute on function public.upsert_ingredient(jsonb) from anon;
revoke execute on function public.upsert_ingredient(jsonb) from authenticated;

comment on function public.upsert_ingredient(jsonb) is
'Input: payload (jsonb) - one ingredient, addressed by code: {code, food_group, nutrition_basis, density_g_per_ml?, grams_per_unit?, names{locale:name}, nutrients{code:amount}, dietary_tags[], units{allowed[],default}, seasonality{region:[months]}}.
Output: bigint - the ingredient''s id.
Overview: writes one complete ingredient - the parent row plus all five companion sets - in a single transaction, so a failure partway leaves nothing changed. Upserts on code, then replaces each companion set wholesale, which makes re-running the seed safe and makes the dataset file the source of truth. Requires a non-blank name in the default locale, because an ingredient with no name is unusable rather than merely incomplete. Leaves retired_at alone, so re-seeding never resurrects a withdrawn ingredient. Everything is resolved by code rather than surrogate id so the dataset stays portable between environments. Raises a named error for any code that does not resolve, rather than silently dropping the row. SECURITY INVOKER on purpose: only the seed script calls it, under a service role that already bypasses RLS, and EXECUTE is revoked from public/anon/authenticated so it can never become a user-facing write path into the catalog.';
