import { matchesSearch, foldForSearch } from "@/lib/text";

/**
 * The searchable surface of one recipe, assembled by the data layer.
 *
 * Ingredient names are included because "what can I make with chicken" is
 * the second thing anyone tries, and `recipe_lines` already holds the
 * answer - it is a join, not new schema.
 */
export type SearchableRecipe = {
  code: string;
  /** Every title the recipe has, in any language. */
  titles: string[];
  /** Stable slugs of the catalog ingredients it uses. */
  ingredientCodes: string[];
  /** Every name those ingredients have, in any language. */
  ingredientNames: string[];
};

/**
 * Whether a recipe matches a search term, by its own name or by something
 * it is made of.
 *
 * Matching runs against every language a recipe and its ingredients have,
 * not only the one being displayed - the same reasoning as the ingredient
 * catalog, where a catalog only partly translated should still be findable
 * by whichever name the cook happens to know.
 *
 * Accent folding comes from the shared helper, so "pollo" finds "Pollo"
 * and "platano" finds "Plátano" here exactly as it does there.
 * @param term The raw search term as typed.
 * @param recipe The recipe's searchable surface.
 * @returns True when the recipe should appear in the results.
 */
export function matchesRecipeSearch(term: string, recipe: SearchableRecipe): boolean {
  if (matchesSearch(term, recipe.code, recipe.titles)) return true;

  const needle = foldForSearch(term.trim());
  if (!needle) return true;

  return (
    recipe.ingredientCodes.some((code) => foldForSearch(code).includes(needle)) ||
    recipe.ingredientNames.some((name) => foldForSearch(name).includes(needle))
  );
}
