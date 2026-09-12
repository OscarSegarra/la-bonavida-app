-- Phase 3, slice 2: make every allowed unit convertible, in the database.
--
-- Phase 2 added density_g_per_ml and grams_per_unit for converting a recipe
-- quantity into the basis an ingredient's nutrition is stated in, left both
-- nullable, and never wrote the conversion logic because nothing computed
-- quantities yet. Phase 3 computes quantities, so a missing factor stops
-- being a gap in curation and becomes a recipe whose nutrition silently
-- cannot be calculated.
--
-- The rule: every unit an ingredient allows must be convertible to that
-- ingredient's nutrition_basis dimension.
--
--   allowed unit | basis      | required
--   mass         | per_100g   | -
--   volume       | per_100ml  | -
--   volume       | per_100g   | density_g_per_ml
--   mass         | per_100ml  | density_g_per_ml
--   count        | per_100g   | grams_per_unit
--   count        | per_100ml  | grams_per_unit AND density_g_per_ml
--
-- Making both columns NOT NULL was the obvious alternative and was
-- rejected: olive oil has no meaningful grams-per-unit and flour has no
-- per-unit weight, so it would demand a number where none exists - and a
-- fabricated value is indistinguishable from a measured one, against
-- Phase 2's own recorded limit that these approximations must never be
-- surfaced as exact. This asks for a number only where one genuinely
-- exists, and still guarantees that no recipe line can be written whose
-- nutrition cannot be computed.
--
-- scripts/validate-ingredients.ts already enforces this on the dataset.
-- That is not a reason to skip it here: the database cannot trust a
-- client, and the seed script is only one of the ways a row could arrive.

-- ---------------------------------------------------------------------
-- 1. Divisibility, gathered now and used by Phase 3's serving sizes.
-- ---------------------------------------------------------------------

alter table public.ingredients
  add column count_divisible boolean;

comment on column public.ingredients.count_divisible is
'Whether a fraction of one is something a person can actually use: half an onion yes, half an egg no. Required exactly where a count unit is allowed and null otherwise, enforced by a trigger added once the catalog has been seeded - the question is meaningless for something nobody counts. It decides which serving sizes a recipe may offer: rather than rounding a scaled quantity, a size is simply not offered when it would need half of something indivisible.';

-- ---------------------------------------------------------------------
-- 2. The convertibility rule.
-- ---------------------------------------------------------------------

/**
 * Whether every unit this ingredient allows can be converted into the
 * dimension its nutrition is declared in.
 *
 * Expressed as "no allowed unit fails" rather than "all succeed" so that
 * an ingredient with no allowed units yet - which happens mid-upsert,
 * between deleting the old set and inserting the new one - is not
 * reported as broken. That transient state is exactly why the triggers
 * below are deferred to commit.
 */
create or replace function private.ingredient_units_are_convertible(p_ingredient_id bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1
    from public.ingredient_allowed_units iau
    join public.units u on u.id = iau.unit_id
    join public.ingredients i on i.id = iau.ingredient_id
    where iau.ingredient_id = p_ingredient_id
      and (
        -- A count unit always needs a weight per unit, whatever the basis.
        (u.dimension = 'count' and i.grams_per_unit is null)
        -- ...and a density too when the basis is a volume, because the
        -- conversion is count -> grams -> millilitres.
        or (u.dimension = 'count'
            and i.nutrition_basis = 'per_100ml'
            and i.density_g_per_ml is null)
        -- Crossing mass and volume in either direction needs a density.
        or (u.dimension = 'mass'
            and i.nutrition_basis = 'per_100ml'
            and i.density_g_per_ml is null)
        or (u.dimension = 'volume'
            and i.nutrition_basis = 'per_100g'
            and i.density_g_per_ml is null)
      )
  );
$$;

comment on function private.ingredient_units_are_convertible(bigint) is
'Input: an ingredient id. Returns true when every unit the ingredient allows can be converted into its nutrition_basis dimension, using density_g_per_ml to cross mass and volume and grams_per_unit to leave a count. Used by the constraint triggers on public.ingredients and public.ingredient_allowed_units; not a permission check.';

/**
 * Constraint-trigger body for the rule above.
 *
 * One function serves both tables because the rule is about the
 * ingredient as a whole, and which table changed only decides where the
 * ingredient id is found.
 */
create or replace function private.check_ingredient_convertibility()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _ingredient_id bigint;
  _code text;
begin
  _ingredient_id := case tg_table_name
    when 'ingredients' then new.id
    else new.ingredient_id
  end;

  if not private.ingredient_units_are_convertible(_ingredient_id) then
    select code into _code from public.ingredients where id = _ingredient_id;
    raise exception
      'ingredient "%" allows a unit that cannot be converted to its nutrition basis: supply density_g_per_ml (mass <-> volume) or grams_per_unit (count), or stop allowing that unit',
      coalesce(_code, _ingredient_id::text);
  end if;

  return null;
end;
$$;

comment on function private.check_ingredient_convertibility() is
'Constraint-trigger body enforcing that every allowed unit of an ingredient is convertible to its nutrition basis. Deferred to commit, because upsert_ingredient rewrites the parent row and its allowed units in one transaction and the intermediate states are legitimately inconsistent.';

-- Deferred to commit, not checked per statement. upsert_ingredient updates
-- the parent row first and replaces the allowed units afterwards, so a
-- mid-transaction check would compare a new density against the *old* unit
-- set and fail an upsert that is perfectly valid once finished.
create constraint trigger ingredients_units_convertible
  after insert or update of nutrition_basis, density_g_per_ml, grams_per_unit
  on public.ingredients
  deferrable initially deferred
  for each row execute function private.check_ingredient_convertibility();

-- Both directions. Without this one the rule could be broken from the
-- other side: allow a volume unit on an ingredient that has no density.
create constraint trigger ingredient_allowed_units_convertible
  after insert or update
  on public.ingredient_allowed_units
  deferrable initially deferred
  for each row execute function private.check_ingredient_convertibility();

-- Deleting an allowed unit can only ever make an ingredient more
-- convertible, so there is deliberately no trigger on delete.

-- ---------------------------------------------------------------------
-- 3. Prove the catalog already satisfies it.
-- ---------------------------------------------------------------------
--
-- The triggers above only fire on write, so without this the existing 62
-- ingredients would go unchecked until something happened to touch them.
-- If this raises, the migration fails and nothing is applied - which is
-- the point.

do $$
declare
  _bad text;
begin
  select string_agg(i.code, ', ' order by i.code) into _bad
  from public.ingredients i
  where not private.ingredient_units_are_convertible(i.id);

  if _bad is not null then
    raise exception
      'these ingredients allow a unit that cannot be converted to their nutrition basis: %',
      _bad;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. upsert_ingredient learns about count_divisible.
-- ---------------------------------------------------------------------
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
    code, food_group_id, nutrition_basis, density_g_per_ml, grams_per_unit,
    count_divisible
  )
  values (
    _code,
    _food_group_id,
    payload ->> 'nutrition_basis',
    (payload ->> 'density_g_per_ml')::numeric,
    (payload ->> 'grams_per_unit')::numeric,
    (payload ->> 'count_divisible')::boolean
  )
  on conflict (code) do update set
    food_group_id    = excluded.food_group_id,
    nutrition_basis  = excluded.nutrition_basis,
    density_g_per_ml = excluded.density_g_per_ml,
    grams_per_unit   = excluded.grams_per_unit,
    count_divisible  = excluded.count_divisible
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

comment on function public.upsert_ingredient(jsonb) is
'Input: payload (jsonb) - one ingredient, addressed by code: {code, food_group, nutrition_basis, density_g_per_ml?, grams_per_unit?, count_divisible?, names{locale:name}, nutrients{code:amount}, dietary_tags[], units{allowed[],default}, seasonality{region:[months]}}. Returns the ingredient id. The catalog''s only write path: upserts the parent row and replaces every companion set in one transaction, so a partial failure leaves nothing changed. Raises on an unknown food group, nutrient, tag, unit or region, on a missing code, on a missing default-locale name, and (at commit) on an allowed unit that cannot be converted to the ingredient''s nutrition basis. Never clears retired_at - un-retiring is an explicit act through set_ingredient_retired(). EXECUTE is revoked from anon and authenticated; the seed script calls it under the service role.';
