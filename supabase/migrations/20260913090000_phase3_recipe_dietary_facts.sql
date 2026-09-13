-- Phase 3, slice 6: what a recipe contains, derived rather than typed.
--
-- Allergen and diet facts are computed from a recipe's ingredients and
-- never hand-applied. A tag saying "vegan" on a recipe whose ingredients
-- say otherwise is a contradiction nothing could resolve - there would be
-- no way to tell which of the two was lying - so the recipe_tags
-- vocabulary is for things a person decides (rapido, cena, navidad) and
-- this is for things the recipe already knows.
--
-- These ship in Phase 3 rather than waiting for the nutrition roll-up in
-- 3b, although both walk the same recursive path. They are set operations
-- with no unit arithmetic, so they are far cheaper than the thing they
-- were originally bundled with - and a browsable catalog that cannot tell
-- someone whether a dish contains gluten is a trust problem rather than a
-- missing convenience.
--
-- THE ASYMMETRY IS THE WHOLE POINT, and it is easy to get backwards:
--
--   Allergens are a UNION.        One gluten-containing ingredient
--                                 anywhere makes the recipe contain
--                                 gluten.
--   Diets are an INTERSECTION.    A recipe is vegan only if EVERY leaf
--                                 ingredient is vegan. One unmarked
--                                 ingredient removes the label.
--
-- Getting either backwards is dangerous in a different direction: a union
-- over diets would label a recipe vegan because one of its ingredients is,
-- and an intersection over allergens would hide gluten unless every
-- ingredient contained it.

/**
 * Every catalog ingredient a recipe is ultimately made of, following
 * sub-recipe lines down to the leaves.
 *
 * Bounded at 20 levels for the same reason as the cycle check: the walk
 * has to terminate even if a cycle somehow exists, and it must not be the
 * thing that hangs when one does. The depth cap of 5 means real data never
 * comes close.
 */
create or replace function private.recipe_leaf_ingredients(p_recipe_id bigint)
returns table (ingredient_id bigint)
language sql
stable
set search_path = ''
as $$
  with recursive reached(recipe_id, depth) as (
    select p_recipe_id, 1
    union all
    select l.sub_recipe_id, r.depth + 1
    from reached r
    join public.recipe_lines l on l.recipe_id = r.recipe_id
    where l.sub_recipe_id is not null
      and r.depth < 20
  )
  select distinct l.ingredient_id
  from reached r
  join public.recipe_lines l on l.recipe_id = r.recipe_id
  where l.ingredient_id is not null;
$$;

comment on function private.recipe_leaf_ingredients(bigint) is
'Input: a recipe id. Returns the distinct catalog ingredients the recipe is ultimately made of, following sub-recipe lines down to the leaves. Bounded at 20 levels so it terminates even in the presence of a cycle. Not a permission check.';

/**
 * The allergens a recipe contains and the diets it satisfies.
 *
 * Reads through ordinary RLS: this is not a `security definer` function,
 * so a caller sees facts derived only from rows they can already read.
 */
create or replace function public.recipe_dietary_facts(p_recipe_id bigint)
returns table (tag_id bigint, code text, category text)
language sql
stable
set search_path = ''
as $$
  with leaves as (
    select l.ingredient_id from private.recipe_leaf_ingredients(p_recipe_id) as l
  ),
  leaf_count as (
    select count(*) as n from leaves
  )
  select t.id, t.code, t.category
  from public.dietary_tags t
  where
    -- Union: any leaf carrying it makes the recipe carry it.
    (
      t.category = 'allergen'
      and exists (
        select 1
        from public.ingredient_dietary_tags idt
        join leaves on leaves.ingredient_id = idt.ingredient_id
        where idt.tag_id = t.id
      )
    )
    or
    -- Intersection: every leaf must carry it, and a recipe with no leaves
    -- at all satisfies nothing rather than everything - which is what the
    -- n > 0 guard is for. Without it, an empty recipe would come back
    -- labelled vegan, halal and everything else, because "all zero of its
    -- ingredients qualify" is vacuously true.
    (
      t.category = 'diet'
      and (select n from leaf_count) > 0
      and (
        select count(*)
        from public.ingredient_dietary_tags idt
        join leaves on leaves.ingredient_id = idt.ingredient_id
        where idt.tag_id = t.id
      ) = (select n from leaf_count)
    )
  order by t.category, t.code;
$$;

comment on function public.recipe_dietary_facts(bigint) is
'Input: a recipe id.
Output: one row per dietary tag the recipe carries - tag_id, code, category.
Overview: derives what a recipe contains from its ingredients rather than from anything typed by hand, walking sub-recipe lines down to the leaf catalog ingredients. Allergens are a UNION (one gluten-containing ingredient anywhere makes the recipe contain gluten); diets are an INTERSECTION (a recipe is vegan only if every leaf ingredient is). A recipe with no leaf ingredients satisfies no diet, rather than vacuously satisfying all of them. Not security definer, so it reads through ordinary RLS and derives facts only from rows the caller can already see.';
