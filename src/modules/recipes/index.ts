/**
 * Connector for the `recipes` module.
 *
 * This is the ONLY file other modules are allowed to import from.
 * Everything under domain/, data/, and ui/ is private — enforced by the
 * boundaries ESLint rule in eslint.config.mjs, not just by convention.
 *
 * Note what is deliberately absent: nothing here writes. The catalog is
 * admin-curated, so its only write path is the `upsert_recipe` database
 * function called by the seed script — never the app.
 *
 * Also absent: translation fallback, text folding and nutrient rendering.
 * Those are shared platform concerns and live in `src/lib`, so publishing
 * them here would claim an ownership this module does not have.
 */

export { listRecipes, getRecipe, listRecipeTags } from "./data/recipes";
export type { RecipeSummary, RecipeDetail, RecipeLine } from "./data/recipes";

export { offeredSizes, scaleQuantity } from "./domain/scaling";
export type { ScalableRecipe, ScalableLine, Dimension } from "./domain/scaling";

export { isBasic } from "./domain/basics";
export { matchesRecipeSearch } from "./domain/search";
export type { SearchableRecipe } from "./domain/search";

export { RecipeList } from "./ui/RecipeList";
export { RecipeFilters } from "./ui/RecipeFilters";
export { RecipeLines } from "./ui/RecipeLines";
export { RecipeSteps } from "./ui/RecipeSteps";
