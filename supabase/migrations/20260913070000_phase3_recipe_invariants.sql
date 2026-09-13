-- Phase 3, slice 4: the rules a recipe must obey, enforced in Postgres.
--
-- Slice 3 built the shape and everything a check constraint can express.
-- These are the rules that need to look at other rows, which is why they
-- are triggers - and why they live here rather than in a Server Action.
--
--   1. Unit validity, two branches. An ingredient line is restricted to
--      that ingredient's allowed units; a sub-recipe line has no row there
--      at all and must instead share a DIMENSION with the sub-recipe's
--      declared yield unit.
--   2. No cycles. A -> B -> A is an infinite loop in both the nutrition
--      roll-up and the shopping list.
--   3. A depth cap of 5, measured across the WHOLE chain rather than
--      downward from the new line - see check_recipe_line below.
--   4. A live recipe may never reference a retired ingredient or a retired
--      sub-recipe, enforced from BOTH sides.
--   5. An allowed unit may not be withdrawn from an ingredient while a
--      live recipe line still uses it.
--
-- Every one of these is a DEFERRABLE INITIALLY DEFERRED constraint
-- trigger, for the reason 20260912120000 spells out: upsert_recipe (slice
-- 5) will rewrite a recipe and all of its companion rows in one
-- transaction, and the intermediate states are legitimately inconsistent.
-- Deferral is also what makes rule 5 survive a re-seed, since
-- upsert_ingredient deletes every allowed unit and re-inserts it.
--
-- Each rule is a named function that the trigger merely calls. That is not
-- decoration: a deferred trigger fires at commit and a pgTAP run never
-- commits, so a rule that exists only inside a trigger body cannot be
-- tested directly. See PHASE_3_PLAN.md section 10.1.

-- ---------------------------------------------------------------------
-- 1. Unit validity
-- ---------------------------------------------------------------------

/**
 * Whether a recipe line's unit is one it is allowed to use.
 *
 * The two branches are genuinely different rules, and Phase 2's table
 * comment originally promised only the first. An ingredient line is
 * restricted to that ingredient's ingredient_allowed_units. A sub-recipe
 * line has no row in that table at all - a recipe is not an ingredient -
 * so it takes its units from the sub-recipe's declared yield instead, and
 * need only agree on dimension: "200 g of cooked rice" against a yield
 * stated in kg is fine, "200 ml" against a yield in grams is not, because
 * a recipe has no density of its own.
 *
 * Returns true for a line that no longer exists. These checks run at
 * commit, by which point a line written earlier in the transaction may
 * have been deleted again - a re-seed does exactly that - and a rule about
 * a row that is gone has nothing to say.
 */
create or replace function private.recipe_line_unit_is_valid(p_line_id bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select case
      when l.ingredient_id is not null then
        exists (
          select 1 from public.ingredient_allowed_units iau
          where iau.ingredient_id = l.ingredient_id
            and iau.unit_id = l.unit_id
        )
      else
        exists (
          select 1
          from public.recipes sr
          join public.units yield_unit on yield_unit.id = sr.yield_unit_id
          join public.units line_unit  on line_unit.id = l.unit_id
          where sr.id = l.sub_recipe_id
            and yield_unit.dimension = line_unit.dimension
        )
    end
    from public.recipe_lines l
    where l.id = p_line_id
  ), true);
$$;

comment on function private.recipe_line_unit_is_valid(bigint) is
'Input: a recipe_lines id. Returns true when the line''s unit is permitted: for an ingredient line, listed in ingredient_allowed_units; for a sub-recipe line, sharing a dimension with the sub-recipe''s yield unit. True for a line that no longer exists, since these checks run at commit and the row may have been deleted since. Not a permission check.';

-- ---------------------------------------------------------------------
-- 2. The recipe graph: cycles and depth
-- ---------------------------------------------------------------------

/**
 * Whether p_to is reachable from p_from by following sub-recipe lines.
 *
 * The depth guard is not an optimisation. If a cycle has somehow already
 * been written, a recursive CTE over it never terminates, so the thing
 * that detects cycles must itself be safe in their presence.
 */
create or replace function private.recipe_reaches(p_from bigint, p_to bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  with recursive reachable(id, depth) as (
    select p_from, 1
    union all
    select l.sub_recipe_id, r.depth + 1
    from reachable r
    join public.recipe_lines l on l.recipe_id = r.id
    where l.sub_recipe_id is not null
      and r.depth < 20
  )
  select exists (select 1 from reachable where id = p_to);
$$;

comment on function private.recipe_reaches(bigint, bigint) is
'Input: two recipe ids. Returns true when the second is reachable from the first by following sub_recipe_id. Used to detect cycles before one is created. Bounded at 20 levels so that it terminates even if a cycle already exists.';

/**
 * The length, in recipes, of the longest chain running through the edge
 * p_parent -> p_child.
 *
 * Measured in BOTH directions on purpose. The depth of a new line is not
 * the depth below it: attaching a two-level sub-recipe to a recipe that is
 * already four levels up somebody else's chain produces a six-level chain,
 * and a check that only looked downward would allow it - then refuse the
 * identical arrangement when the lines happened to be written in the other
 * order. Measuring the whole chain makes the cap mean the same thing
 * however the recipes were built up.
 */
create or replace function private.recipe_chain_length(p_parent bigint, p_child bigint)
returns integer
language sql
stable
set search_path = ''
as $$
  with recursive above(id, depth) as (
    select p_parent, 1
    union all
    select l.recipe_id, a.depth + 1
    from above a
    join public.recipe_lines l on l.sub_recipe_id = a.id
    where a.depth < 20
  ),
  below(id, depth) as (
    select p_child, 1
    union all
    select l.sub_recipe_id, b.depth + 1
    from below b
    join public.recipe_lines l on l.recipe_id = b.id
    where l.sub_recipe_id is not null
      and b.depth < 20
  )
  select (select max(depth) from above) + (select max(depth) from below);
$$;

comment on function private.recipe_chain_length(bigint, bigint) is
'Input: the two ends of a sub-recipe edge. Returns how many recipes long the longest chain through that edge is, counting ancestors of the parent as well as descendants of the child. Bounded at 20 levels per direction so it terminates in the presence of a cycle.';

-- ---------------------------------------------------------------------
-- 3. Retirement consistency
-- ---------------------------------------------------------------------

/**
 * Whether a line's target is allowed to be in the state it is in.
 *
 * Retirement works by hiding the row from readers, so a LIVE recipe
 * holding a foreign key to a retired ingredient would render with a line
 * silently missing and its nutrition quietly too low - no error, no broken
 * page, just a smaller number. A retired recipe may point at whatever it
 * likes, since nobody can see it either.
 */
create or replace function private.recipe_line_retirement_is_consistent(p_line_id bigint)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select
      parent.retired_at is not null
      or (
        (ingredient.id is null or ingredient.retired_at is null)
        and (sub_recipe.id is null or sub_recipe.retired_at is null)
      )
    from public.recipe_lines l
    join public.recipes parent on parent.id = l.recipe_id
    left join public.ingredients ingredient on ingredient.id = l.ingredient_id
    left join public.recipes sub_recipe on sub_recipe.id = l.sub_recipe_id
    where l.id = p_line_id
  ), true);
$$;

comment on function private.recipe_line_retirement_is_consistent(bigint) is
'Input: a recipe_lines id. Returns true unless a live recipe references a retired ingredient or a retired sub-recipe. A retired recipe may reference anything, since it is hidden from readers too. True for a line that no longer exists.';

-- ---------------------------------------------------------------------
-- 4. One assertion for everything about a line
-- ---------------------------------------------------------------------

/**
 * Raises if a recipe line breaks any of the rules above, naming which.
 *
 * Reads the line back by id rather than trusting the trigger's NEW row:
 * these checks run at commit, and NEW is the row as it was when the
 * statement ran, which a later statement in the same transaction may have
 * changed or deleted.
 */
create or replace function private.assert_recipe_line(p_line_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  _line record;
  _parent_code text;
begin
  select * into _line from public.recipe_lines where id = p_line_id;
  if not found then
    return;
  end if;

  select code into _parent_code from public.recipes where id = _line.recipe_id;

  if not private.recipe_line_unit_is_valid(p_line_id) then
    raise exception
      'recipe "%" line %: unit is not permitted - an ingredient line must use one of that ingredient''s allowed units, and a sub-recipe line must use the same dimension as the sub-recipe''s yield',
      _parent_code, _line.position;
  end if;

  if not private.recipe_line_retirement_is_consistent(p_line_id) then
    raise exception
      'recipe "%" line %: a live recipe cannot reference a retired ingredient or a retired sub-recipe - retirement hides the row from readers, so the line would silently vanish',
      _parent_code, _line.position;
  end if;

  if _line.sub_recipe_id is not null then
    if private.recipe_reaches(_line.sub_recipe_id, _line.recipe_id) then
      raise exception
        'recipe "%" line %: this would create a cycle - the sub-recipe already leads back to this recipe',
        _parent_code, _line.position;
    end if;

    if private.recipe_chain_length(_line.recipe_id, _line.sub_recipe_id) > 5 then
      raise exception
        'recipe "%" line %: sub-recipes may not nest more than 5 deep, counting the whole chain and not just what is below this line',
        _parent_code, _line.position;
    end if;
  end if;
end;
$$;

comment on function private.assert_recipe_line(bigint) is
'Raises when a recipe line breaks unit validity, retirement consistency, the no-cycles rule or the depth cap, naming the recipe and line position. Reads the line back by id rather than trusting NEW, because these checks run at commit and NEW is the row as it was when the statement ran.';

-- ---------------------------------------------------------------------
-- 5. Trigger bodies
-- ---------------------------------------------------------------------
--
-- One per table, never one function branching on TG_TABLE_NAME: plpgsql
-- resolves every field reference in an expression when it plans it rather
-- than when a branch is taken, so a single function cannot read new.id on
-- one table and new.ingredient_id on another. That mistake shipped in
-- 20260912120000 and was caught by the first real pgTAP run.

create or replace function private.check_recipe_line()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_recipe_line(new.id);
  return null;
end;
$$;

comment on function private.check_recipe_line() is
'Constraint-trigger body on public.recipe_lines. Deferred to commit, because upsert_recipe rewrites a recipe and all of its lines in one transaction and the intermediate states are legitimately inconsistent.';

/**
 * Refuses to retire an ingredient that a live recipe still uses.
 *
 * The other half of the retirement rule, and the half that matters:
 * retiring is the common operation, while writing a line onto an
 * already-retired ingredient is not.
 */
create or replace function private.check_ingredient_retirement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _retired timestamptz;
  _code text;
  _users text;
begin
  -- Re-read rather than trusting NEW: a later statement in the same
  -- transaction may have un-retired it again.
  select retired_at, code into _retired, _code
  from public.ingredients where id = new.id;

  if _retired is null then
    return null;
  end if;

  select string_agg(distinct r.code, ', ' order by r.code) into _users
  from public.recipe_lines l
  join public.recipes r on r.id = l.recipe_id
  where l.ingredient_id = new.id
    and r.retired_at is null;

  if _users is not null then
    raise exception
      'cannot retire ingredient "%": these live recipes still use it: % - retire or amend them first',
      _code, _users;
  end if;

  return null;
end;
$$;

comment on function private.check_ingredient_retirement() is
'Constraint-trigger body on public.ingredients refusing to retire an ingredient that a live recipe still references. Without it, retirement would hide the ingredient and leave those recipes rendering a line short with nutrition quietly too low.';

/**
 * The same rule for a recipe used as a sub-recipe.
 */
create or replace function private.check_recipe_retirement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _retired timestamptz;
  _code text;
  _users text;
begin
  select retired_at, code into _retired, _code
  from public.recipes where id = new.id;

  if _retired is null then
    return null;
  end if;

  select string_agg(distinct r.code, ', ' order by r.code) into _users
  from public.recipe_lines l
  join public.recipes r on r.id = l.recipe_id
  where l.sub_recipe_id = new.id
    and r.retired_at is null;

  if _users is not null then
    raise exception
      'cannot retire recipe "%": these live recipes use it as a sub-recipe: % - retire or amend them first',
      _code, _users;
  end if;

  return null;
end;
$$;

comment on function private.check_recipe_retirement() is
'Constraint-trigger body on public.recipes refusing to retire a recipe that a live recipe still uses as a sub-recipe. The same trap as the ingredient rule, one level up.';

/**
 * Refuses to withdraw an allowed unit that a live recipe line still uses.
 *
 * Uses OLD, so it is a separate function from the ones above rather than a
 * branch inside them. Deferral is what makes this survive a re-seed:
 * upsert_ingredient deletes every allowed unit and re-inserts it, so at
 * commit the rows are back and nothing has really been withdrawn.
 */
create or replace function private.check_allowed_unit_removal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _users text;
  _code text;
begin
  if exists (
    select 1 from public.ingredient_allowed_units
    where ingredient_id = old.ingredient_id and unit_id = old.unit_id
  ) then
    return null;
  end if;

  select string_agg(distinct r.code, ', ' order by r.code) into _users
  from public.recipe_lines l
  join public.recipes r on r.id = l.recipe_id
  where l.ingredient_id = old.ingredient_id
    and l.unit_id = old.unit_id
    and r.retired_at is null;

  if _users is not null then
    select code into _code from public.ingredients where id = old.ingredient_id;
    raise exception
      'cannot stop allowing that unit for ingredient "%": these live recipes measure it that way: %',
      coalesce(_code, old.ingredient_id::text), _users;
  end if;

  return null;
end;
$$;

comment on function private.check_allowed_unit_removal() is
'Constraint-trigger body on public.ingredient_allowed_units refusing to withdraw a unit a live recipe line still uses, which would otherwise leave that line measured in a unit its ingredient no longer permits. Returns early when the pair is present again at commit, which is what lets a re-seed delete and re-insert the whole set.';

-- ---------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------

create constraint trigger recipe_lines_valid
  after insert or update
  on public.recipe_lines
  deferrable initially deferred
  for each row execute function private.check_recipe_line();

create constraint trigger ingredients_retirement_unused
  after update of retired_at
  on public.ingredients
  deferrable initially deferred
  for each row execute function private.check_ingredient_retirement();

create constraint trigger recipes_retirement_unused
  after update of retired_at
  on public.recipes
  deferrable initially deferred
  for each row execute function private.check_recipe_retirement();

create constraint trigger ingredient_allowed_units_still_used
  after delete
  on public.ingredient_allowed_units
  deferrable initially deferred
  for each row execute function private.check_allowed_unit_removal();
