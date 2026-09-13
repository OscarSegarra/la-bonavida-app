/**
 * Whether a recipe is a "basic": a piece of fruit, a handful of almonds, a
 * glass of milk.
 *
 * These exist so a meal plan can say "breakfast: an apple" without needing
 * a second concept alongside recipes, and so the fridge and the shopping
 * list only ever deal in one kind of thing. The cost is that the catalog
 * fills with single-ingredient entries, and a browse list where "Manzana"
 * outnumbers "Paella valenciana" is a bad list - so they are hidden from
 * the main list by default, while staying fully searchable and usable in a
 * meal plan.
 *
 * Derived rather than tagged, deliberately. "One line and no steps" is
 * already what the word means, so there is no tagging discipline to keep
 * up and nothing that can drift out of sync with the recipe it describes.
 * A real dish always has at least one step. If a counterexample ever turns
 * up, a tag can override this without a migration.
 * @param recipe How many lines and steps the recipe has.
 * @returns True when it should be hidden from the default browse list.
 */
export function isBasic(recipe: { lineCount: number; stepCount: number }): boolean {
  return recipe.lineCount === 1 && recipe.stepCount === 0;
}
