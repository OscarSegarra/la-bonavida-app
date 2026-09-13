-- Phase 3, slice 2b: require an answer to "is half of one usable?" wherever
-- the question can be asked.
--
-- Split from 20260912120000 on purpose, and the split is the interesting
-- part. That migration adds the count_divisible column; the values come
-- from the seed dataset, not from a migration, because they are curated
-- data that belongs next to the ingredient it describes. So the rule
-- requiring the column to be filled cannot be switched on in the same
-- breath as the column appearing - at that instant every existing row is
-- null and the catalog would fail its own new invariant.
--
-- The order is create -> seed -> alter, the same sequencing the Phase 2
-- review made explicit for households.region_id:
--
--   1. 20260912120000  adds the column
--   2. pnpm run seed:ingredients   fills it for all 62 ingredients
--   3. this migration  starts requiring it
--
-- On a fresh database - CI's `supabase start`, or a new environment - there
-- are no ingredients at all when this runs, so the check below passes
-- vacuously and the two migrations can be applied back to back. Only an
-- already-populated environment (preprod) needs the seed run in between.

-- ---------------------------------------------------------------------
-- 1. The rule.
-- ---------------------------------------------------------------------

/**
 * Whether this ingredient answers the divisibility question exactly when
 * the question applies to it.
 *
 * A biconditional rather than a one-way check, because both halves are
 * real. Without "required where a count unit is allowed", a new
 * count-based ingredient silently carries no answer, and the reading that
 * looks harmless - treat null as divisible - is the one that puts half an
 * egg back on a recipe. Without "forbidden otherwise", the flag spreads to
 * ingredients nobody counts, where it means nothing and will eventually be
 * believed by something.
 */
create or replace function private.ingredient_divisibility_is_answered(p_ingredient_id bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.ingredient_allowed_units iau
      join public.units u on u.id = iau.unit_id
      where iau.ingredient_id = p_ingredient_id
        and u.dimension = 'count'
    )
    = (
      select i.count_divisible is not null
      from public.ingredients i
      where i.id = p_ingredient_id
    );
$$;

comment on function private.ingredient_divisibility_is_answered(bigint) is
'Input: an ingredient id. Returns true when count_divisible is set exactly where a count unit is allowed, and unset everywhere else. Used by the constraint triggers on public.ingredients and public.ingredient_allowed_units; not a permission check.';

/**
 * Raises if this ingredient does not answer the divisibility question
 * exactly where the question applies. Stated once; the wrappers below only
 * say where the ingredient id is found.
 */
create or replace function private.assert_ingredient_divisibility(p_ingredient_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  _code text;
begin
  if not private.ingredient_divisibility_is_answered(p_ingredient_id) then
    select code into _code from public.ingredients where id = p_ingredient_id;
    raise exception
      'ingredient "%": count_divisible must be set when a count unit is allowed and null when it is not - say whether half of one is usable',
      coalesce(_code, p_ingredient_id::text);
  end if;
end;
$$;

comment on function private.assert_ingredient_divisibility(bigint) is
'Raises when an ingredient sets count_divisible without allowing a count unit, or allows one without setting it. Called by the constraint triggers on public.ingredients and public.ingredient_allowed_units; not a permission check.';

/**
 * Trigger wrappers: one per table, for the reason spelled out in
 * 20260912120000 - plpgsql plans every field reference in an expression
 * whether or not its branch is taken, so a single function switching on
 * TG_TABLE_NAME cannot read `new.id` on one table and `new.ingredient_id`
 * on another.
 */
create or replace function private.check_ingredients_divisibility()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_ingredient_divisibility(new.id);
  return null;
end;
$$;

comment on function private.check_ingredients_divisibility() is
'Constraint-trigger body on public.ingredients enforcing that count_divisible is answered exactly where a count unit is allowed. Deferred to commit, because upsert_ingredient writes the parent row before replacing its allowed units and the intermediate states are legitimately inconsistent.';

create or replace function private.check_allowed_units_divisibility()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_ingredient_divisibility(new.ingredient_id);
  return null;
end;
$$;

comment on function private.check_allowed_units_divisibility() is
'Constraint-trigger body on public.ingredient_allowed_units enforcing the same rule from the other side: it catches allowing a count unit on an ingredient that never answered the question.';

-- Deferred for the same reason as the convertibility triggers: an upsert
-- sets count_divisible on the parent row before the allowed units that
-- make it required even exist.
create constraint trigger ingredients_divisibility_answered
  after insert or update of count_divisible
  on public.ingredients
  deferrable initially deferred
  for each row execute function private.check_ingredients_divisibility();

-- The other direction: allowing a count unit on an ingredient that never
-- answered the question.
create constraint trigger ingredient_allowed_units_divisibility_answered
  after insert or update
  on public.ingredient_allowed_units
  deferrable initially deferred
  for each row execute function private.check_allowed_units_divisibility();

-- ---------------------------------------------------------------------
-- 2. Prove the catalog already satisfies it.
-- ---------------------------------------------------------------------
--
-- Vacuous on a fresh database. On preprod this is what fails loudly if
-- the seed has not been re-run since 20260912120000 - which is precisely
-- the mistake this split exists to make visible rather than silent.

do $$
declare
  _bad text;
begin
  select string_agg(i.code, ', ' order by i.code) into _bad
  from public.ingredients i
  where not private.ingredient_divisibility_is_answered(i.id);

  if _bad is not null then
    raise exception
      'these ingredients do not answer count_divisible correctly: % - run `pnpm run seed:ingredients` before applying this migration',
      _bad;
  end if;
end;
$$;
