-- Phase 3, slice 5: the recipe catalog's only write path.
--
-- Why a database function rather than a sequence of client calls: one
-- recipe spans seven tables, and a failure partway must leave none of them
-- changed. The seed script talks to PostgREST, where every call is its own
-- transaction, so separate writes cannot be wrapped in one. A function
-- body IS a single transaction, so a failure anywhere in here rolls the
-- whole recipe back with nothing for the client to manage.
--
-- Exactly the resolution upsert_ingredient reached, and for the same
-- reason. The re-seed path makes it sharper still: replacing companion
-- rows is a delete followed by an insert, so a failure in between would
-- not merely fail to add data, it would destroy a previously-good recipe's
-- steps.
--
-- Everything is addressed by `code`, never by surrogate id, so the seed
-- dataset stays portable across environments.
--
-- NOTE ON PRIVILEGES: this is NOT `security definer`, matching
-- upsert_ingredient and set_ingredient_retired. PHASE_3_PLAN.md said
-- security definer, and the implementation it described does not use it -
-- EXECUTE is simply revoked from public, anon and authenticated, and the
-- seed script calls it under the service role, which holds BYPASSRLS.
-- That is strictly the safer of the two: a definer function is a standing
-- privilege-escalation surface, and here there is nothing to escalate.
--
-- The four obligations the design review pinned down are marked (1)-(4)
-- below.

create or replace function public.upsert_recipe(payload jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  _recipe_id      bigint;
  _code           text := payload ->> 'code';
  _yield_unit_id  bigint;
  _default_locale text;
  _locales        text[];
  _missing        text;
  _step           jsonb;
  _ord            integer;
  _step_id        bigint;
begin
  if _code is null or length(trim(_code)) = 0 then
    raise exception 'upsert_recipe: payload has no "code"';
  end if;

  -- ---------------------------------------------------------------
  -- Validate before writing anything, so a bad payload leaves no
  -- half-built recipe behind.
  -- ---------------------------------------------------------------

  select code into _default_locale from public.locales where is_default;
  if _default_locale is null then
    raise exception 'upsert_recipe(%): no default locale is configured', _code;
  end if;

  if coalesce(trim(payload #>> array['translations', _default_locale, 'title']), '') = '' then
    raise exception 'upsert_recipe(%): no title for the default locale "%"',
      _code, _default_locale;
  end if;

  -- The locales this recipe claims to exist in: those with a real title.
  select array_agg(key order by key) into _locales
  from jsonb_each(coalesce(payload -> 'translations', '{}'::jsonb)) as e(key, value)
  where coalesce(trim(value ->> 'title'), '') <> '';

  select string_agg(loc, ', ') into _missing
  from unnest(_locales) as loc
  where not exists (select 1 from public.locales where code = loc);
  if _missing is not null then
    raise exception 'upsert_recipe(%): unknown locale(s): %', _code, _missing;
  end if;

  -- (3) A step must exist in every locale the recipe claims, and in no
  -- others. Per-step fallback would otherwise produce a recipe that is
  -- Catalan for four steps and Spanish for the fifth - technically valid,
  -- visibly broken - and the reader would have no way to tell that the
  -- translation was simply missing.
  select string_agg(format('step %s', e.ord), ', ' order by e.ord) into _missing
  from jsonb_array_elements(coalesce(payload -> 'steps', '[]'::jsonb))
       with ordinality as e(step, ord)
  where (select array_agg(key order by key) from jsonb_each_text(e.step)) is distinct from _locales;
  if _missing is not null then
    raise exception
      'upsert_recipe(%): % do not cover exactly the locales this recipe declares (%)',
      _code, _missing, array_to_string(_locales, ', ');
  end if;

  -- (4) A recipe with no lines is not a recipe. Note that a recipe with no
  -- STEPS is perfectly normal - an apple, a glass of milk - and is in fact
  -- how "basic" entries are recognised, so steps are not required here.
  if jsonb_array_length(coalesce(payload -> 'lines', '[]'::jsonb)) = 0 then
    raise exception 'upsert_recipe(%): a recipe must have at least one line', _code;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(payload -> 'lines') as e(line)
    where (case when e.line ? 'ingredient' then 1 else 0 end)
        + (case when e.line ? 'recipe'     then 1 else 0 end) <> 1
  ) then
    raise exception
      'upsert_recipe(%): every line must name exactly one of "ingredient" or "recipe"', _code;
  end if;

  select id into _yield_unit_id from public.units where code = payload #>> '{yield,unit}';
  if _yield_unit_id is null then
    raise exception 'upsert_recipe(%): unknown yield unit "%"',
      _code, payload #>> '{yield,unit}';
  end if;

  -- Unknown codes are raised one class at a time, each naming everything
  -- it could not resolve, because a join would simply drop them and leave
  -- the recipe quietly missing an ingredient.
  select string_agg(distinct e.line ->> 'ingredient', ', ') into _missing
  from jsonb_array_elements(payload -> 'lines') as e(line)
  where e.line ? 'ingredient'
    and not exists (select 1 from public.ingredients where code = e.line ->> 'ingredient');
  if _missing is not null then
    raise exception 'upsert_recipe(%): unknown ingredient code(s): %', _code, _missing;
  end if;

  -- A sub-recipe has to exist already, which is why the importer applies
  -- the dataset in dependency order.
  select string_agg(distinct e.line ->> 'recipe', ', ') into _missing
  from jsonb_array_elements(payload -> 'lines') as e(line)
  where e.line ? 'recipe'
    and not exists (select 1 from public.recipes where code = e.line ->> 'recipe');
  if _missing is not null then
    raise exception
      'upsert_recipe(%): unknown sub-recipe code(s): % - a sub-recipe must be imported before the recipe using it',
      _code, _missing;
  end if;

  select string_agg(distinct e.line ->> 'unit', ', ') into _missing
  from jsonb_array_elements(payload -> 'lines') as e(line)
  where not exists (select 1 from public.units where code = e.line ->> 'unit');
  if _missing is not null then
    raise exception 'upsert_recipe(%): unknown unit code(s): %', _code, _missing;
  end if;

  select string_agg(tag, ', ') into _missing
  from jsonb_array_elements_text(coalesce(payload -> 'tags', '[]'::jsonb)) as tag
  where not exists (select 1 from public.recipe_tags where code = tag);
  if _missing is not null then
    raise exception 'upsert_recipe(%): unknown recipe tag(s): %', _code, _missing;
  end if;

  select string_agg(e.key, ', ') into _missing
  from jsonb_each(coalesce(payload -> 'nutrient_overrides', '{}'::jsonb)) as e(key, value)
  where not exists (select 1 from public.nutrients where code = e.key);
  if _missing is not null then
    raise exception 'upsert_recipe(%): unknown nutrient code(s) in overrides: %', _code, _missing;
  end if;

  -- ---------------------------------------------------------------
  -- Write.
  -- ---------------------------------------------------------------

  -- (1) retired_at is deliberately NOT touched. Re-running the seed must
  -- not quietly resurrect something an admin withdrew; un-retiring is an
  -- explicit act through set_recipe_retired().
  insert into public.recipes (
    code, servings, min_servings, yield_quantity, yield_unit_id
  )
  values (
    _code,
    (payload ->> 'servings')::integer,
    coalesce((payload ->> 'min_servings')::integer, 1),
    (payload #>> '{yield,quantity}')::numeric,
    _yield_unit_id
  )
  on conflict (code) do update set
    servings       = excluded.servings,
    min_servings   = excluded.min_servings,
    yield_quantity = excluded.yield_quantity,
    yield_unit_id  = excluded.yield_unit_id
  returning id into _recipe_id;

  -- Companion sets are replaced wholesale rather than merged: the dataset
  -- file is the source of truth, so removing a step or a tag there must
  -- remove it here too.

  delete from public.recipe_translations where recipe_id = _recipe_id;
  insert into public.recipe_translations (recipe_id, locale, title, description)
  select _recipe_id, e.key, e.value ->> 'title', nullif(trim(coalesce(e.value ->> 'description', '')), '')
  from jsonb_each(coalesce(payload -> 'translations', '{}'::jsonb)) as e(key, value)
  where e.key = any(_locales);

  -- (2) Positions are renumbered 1..n from the dataset's order, so a gap
  -- or a duplicate in the source file cannot reach the database. Deleting
  -- the steps cascades their translations.
  delete from public.recipe_steps where recipe_id = _recipe_id;
  for _step, _ord in
    select value, ordinality
    from jsonb_array_elements(coalesce(payload -> 'steps', '[]'::jsonb)) with ordinality
  loop
    insert into public.recipe_steps (recipe_id, position)
    values (_recipe_id, _ord)
    returning id into _step_id;

    insert into public.recipe_step_translations (step_id, locale, body)
    select _step_id, key, value
    from jsonb_each_text(_step);
  end loop;

  delete from public.recipe_lines where recipe_id = _recipe_id;
  insert into public.recipe_lines (
    recipe_id, position, ingredient_id, sub_recipe_id, quantity, unit_id
  )
  select
    _recipe_id,
    e.ord,
    (select id from public.ingredients where code = e.line ->> 'ingredient'),
    (select id from public.recipes     where code = e.line ->> 'recipe'),
    (e.line ->> 'quantity')::numeric,
    (select id from public.units       where code = e.line ->> 'unit')
  from jsonb_array_elements(payload -> 'lines') with ordinality as e(line, ord);

  delete from public.recipe_tag_assignments where recipe_id = _recipe_id;
  insert into public.recipe_tag_assignments (recipe_id, tag_id)
  select _recipe_id, t.id
  from jsonb_array_elements_text(coalesce(payload -> 'tags', '[]'::jsonb)) as tag
  join public.recipe_tags t on t.code = tag;

  delete from public.recipe_nutrient_overrides where recipe_id = _recipe_id;
  insert into public.recipe_nutrient_overrides (recipe_id, nutrient_id, value)
  select _recipe_id, n.id, (e.value #>> '{}')::numeric
  from jsonb_each(coalesce(payload -> 'nutrient_overrides', '{}'::jsonb)) as e(key, value)
  join public.nutrients n on n.code = e.key;

  return _recipe_id;
end;
$$;

revoke execute on function public.upsert_recipe(jsonb) from public;
revoke execute on function public.upsert_recipe(jsonb) from anon;
revoke execute on function public.upsert_recipe(jsonb) from authenticated;

comment on function public.upsert_recipe(jsonb) is
'Input: payload (jsonb) - one recipe, addressed by code: {code, servings, min_servings?, yield{quantity,unit}, translations{locale:{title,description?}}, steps[{locale:body}], lines[{ingredient|recipe, quantity, unit}], tags[], nutrient_overrides{code:value}}.
Output: bigint - the recipe''s id.
Overview: the recipe catalog''s only write path. Upserts the parent row and replaces every companion set in one transaction, so a partial failure leaves nothing changed. Renumbers step positions 1..n from the dataset order. Requires a title in the default locale, and requires every step to cover exactly the locales the recipe declares, so a recipe can never render half in one language. Requires at least one line; steps are optional, because a one-line recipe with no steps is how a basic entry (an apple, a glass of milk) is represented. Raises on any unresolved ingredient, sub-recipe, unit, tag, nutrient or locale code rather than dropping it silently. Never clears retired_at - un-retiring is an explicit act through set_recipe_retired(). EXECUTE is revoked from public/anon/authenticated; the seed script calls it under the service role.';

-- ---------------------------------------------------------------------
-- Retirement, both directions in one function
-- ---------------------------------------------------------------------
--
-- Identical in shape to set_ingredient_retired, deliberately: retiring by
-- mistake needs an undo, and a second near-identical function would be the
-- thing that drifts. coalesce on the way in preserves the original
-- timestamp, so re-running a retire is idempotent rather than quietly
-- resetting when it happened.
--
-- The recipes_retirement_unused trigger from 20260913070000 is what stops
-- this from hiding a recipe that another live recipe still uses as a
-- sub-recipe; it fires at commit and raises with the list.

create or replace function public.set_recipe_retired(_code text, _retired boolean)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  _id bigint;
begin
  update public.recipes
     set retired_at = case when _retired then coalesce(retired_at, now()) else null end
   where code = _code
  returning id into _id;

  -- An unknown code is an error rather than a no-op: this is called by a
  -- human deciding to withdraw something, and silently doing nothing is
  -- the outcome most likely to be mistaken for success.
  if _id is null then
    raise exception 'set_recipe_retired: unknown recipe code "%"', _code;
  end if;

  return _id;
end;
$$;

revoke execute on function public.set_recipe_retired(text, boolean) from public;
revoke execute on function public.set_recipe_retired(text, boolean) from anon;
revoke execute on function public.set_recipe_retired(text, boolean) from authenticated;

comment on function public.set_recipe_retired(text, boolean) is
'Input: _code (text) - the recipe''s stable slug; _retired (boolean) - true to withdraw, false to restore.
Output: bigint - the recipe''s id.
Overview: withdraws a recipe from the catalog without deleting it, so anything already referencing it keeps resolving, and restores it again. Retired rows are hidden from authenticated readers by the recipes_select policy rather than by a filter each query has to remember. Idempotent: re-retiring keeps the original timestamp. Raises on an unknown code, and - through the recipes_retirement_unused trigger - refuses to retire a recipe that a live recipe still uses as a sub-recipe. Admin-only: EXECUTE is revoked from public/anon/authenticated.';
