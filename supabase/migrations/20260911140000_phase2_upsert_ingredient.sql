-- Phase 2, slice 4: the catalog's only write path.
--
-- Why a database function rather than a sequence of client calls: one
-- ingredient spans six tables, and a failure partway must leave none of
-- them changed. The seed script talks to PostgREST, where every call is
-- its own transaction, so five separate writes cannot be wrapped in one.
-- A function body IS a single transaction, so a failure anywhere in here
-- rolls the whole ingredient back with nothing for the client to manage.
--
-- This is the same resolution Phase 1 reached for create_household, and
-- for the same reason: a multi-row write that must be all-or-nothing
-- belongs in Postgres, not in application code. The re-seed path makes it
-- sharper still - replacing companion rows is a delete followed by an
-- insert, so a failure in between would not merely fail to add data, it
-- would destroy a previously-good ingredient's name. Re-running the seed
-- is meant to be the safe operation; this boundary is what makes it one.
--
-- Everything is addressed by `code`, never by surrogate id, so the seed
-- dataset stays portable across environments - ids differ between preprod
-- and prod, codes do not.

create or replace function public.upsert_ingredient(payload jsonb)
returns bigint
language plpgsql
as $$
declare
  _ingredient_id bigint;
  _food_group_id bigint;
  _default_unit text;
  _allowed_units text[];
  _code text := payload ->> 'code';
  _missing text;
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

  -- Parent row. ON CONFLICT makes a re-seed an update rather than a
  -- duplicate, which is what lets the whole dataset be re-applied safely.
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

-- Deliberately SECURITY INVOKER (the default), unlike create_household.
-- That one needs elevation because end users call it; this one is only
-- ever called by the seed script under the service role, which already
-- bypasses RLS. Running it as its owner would gain nothing and would turn
-- any accidental grant into a full write path past every catalog policy.
--
-- EXECUTE is revoked from everyone: `public` covers the PUBLIC
-- pseudo-role that Postgres grants to new functions by default (the
-- anon-vs-PUBLIC trap from Phase 1's invite migration), and anon and
-- authenticated are named explicitly so the intent is legible rather than
-- inherited. Granting this to `authenticated` would hand every signed-in
-- user a write path into the admin-curated catalog - the single thing
-- this phase's RLS model exists to prevent.
revoke execute on function public.upsert_ingredient(jsonb) from public;
revoke execute on function public.upsert_ingredient(jsonb) from anon;
revoke execute on function public.upsert_ingredient(jsonb) from authenticated;

comment on function public.upsert_ingredient(jsonb) is
'Input: payload (jsonb) - one ingredient, addressed by code: {code, food_group, nutrition_basis, density_g_per_ml?, grams_per_unit?, names{locale:name}, nutrients{code:amount}, dietary_tags[], units{allowed[],default}, seasonality{region:[months]}}.
Output: bigint - the ingredient''s id.
Overview: writes one complete ingredient - the parent row plus all five companion sets - in a single transaction, so a failure partway leaves nothing changed. Upserts on code, then replaces each companion set wholesale, which makes re-running the seed safe and makes the dataset file the source of truth. Everything is resolved by code rather than surrogate id so the dataset stays portable between environments. Raises a named error for any code that does not resolve, rather than silently dropping the row. SECURITY INVOKER on purpose: only the seed script calls it, under a service role that already bypasses RLS, and EXECUTE is revoked from public/anon/authenticated so it can never become a user-facing write path into the catalog.';
