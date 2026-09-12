-- Corrects a promise Phase 2 made to Phase 3 that Phase 3 cannot keep.
--
-- public.ingredient_allowed_units said:
--
--   "Phase 3 will enforce that a recipe line may only use a unit listed
--    here for the ingredient it references."
--
-- That is right for a recipe line pointing at a catalog ingredient, and
-- silently wrong for one pointing at another recipe. A cooked component -
-- boiled rice used both on its own and inside something else - is not a
-- catalog ingredient and has no row in this table at all, so there is no
-- allowed-unit list here to check it against. Left as written, the
-- sentence reads as a rule covering every recipe line, and the first
-- person implementing it would either reject every sub-recipe line or
-- quietly drop the check.
--
-- Nothing about the data changes - this is a comment, and comments on
-- this project's schema are real queryable metadata rather than prose in
-- a file, which is exactly why a wrong one is worth a migration.
--
-- The rule for sub-recipe lines lives with the recipes schema instead:
-- their units come from the sub-recipe's own declared yield.
comment on table public.ingredient_allowed_units is
'Which units make sense for a given ingredient - eggs by count, milk by volume, flour by mass or tablespoons. Phase 3 enforces that a recipe line referencing a CATALOG INGREDIENT may only use a unit listed here for that ingredient.

That rule deliberately does NOT extend to a recipe line referencing another recipe - a cooked component such as boiled rice, usable on its own or inside something else. Such a line has no row in this table, because a recipe is not a catalog ingredient: this catalog is global and admin-curated, while recipes are household-scoped and user-written, and promoting one into the other would put household data in a shared table. A sub-recipe line takes its units from the sub-recipe''s own declared yield unit and whatever converts to it. See DECISIONS.md, "A cooked recipe can be an ingredient of another recipe".';
