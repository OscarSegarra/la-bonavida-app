/**
 * The shape of the recipe seed dataset, typed against the vocabularies the
 * migrations seed.
 *
 * These unions deliberately restate what is already in the database, for
 * the same reason `ingredient-types.ts` does: a mistyped unit or tag
 * becomes a compile error caught by `pnpm run typecheck` in CI rather than
 * a runtime error from the importer, before anyone runs it against an
 * environment. `upsert_recipe` still validates everything at runtime,
 * because the database cannot trust a client.
 *
 * Ingredient and sub-recipe codes are deliberately NOT unions. They are
 * checked by the validator against the actual datasets instead, which is
 * stronger than a hand-copied list: a union would be one more place to
 * forget when an ingredient is added, and it would go stale silently.
 */

import type { LocaleCode, UnitCode } from "./ingredient-types.ts";

export type { LocaleCode, UnitCode };

/**
 * Mirrors `public.recipe_tags`, seeded by 20260913100000.
 *
 * Labels a person applies: when you would eat it, and how much work it is.
 * There are deliberately no diet or allergen tags - what a recipe contains
 * is derived from its ingredients, so a hand-applied "vegan" could
 * contradict the recipe itself.
 */
export type RecipeTagCode =
  | "desayuno"
  | "comida"
  | "cena"
  | "postre"
  | "guarnicion"
  | "rapido"
  | "una_olla"
  | "horno";

/** One step's text, in every language the recipe is written in. */
export type SeedStep = Partial<Record<LocaleCode, string>>;

/**
 * One line of a recipe: a quantity of either a catalog ingredient or
 * another recipe, never both and never neither.
 */
export type SeedRecipeLine = {
  /** An ingredient code from `data/ingredients.ts`. */
  ingredient?: string;
  /** Another recipe's code from this file. */
  recipe?: string;
  quantity: number;
  unit: UnitCode;
};

export type SeedRecipe = {
  /** Stable identity. Never a title - titles are per-locale and vary. */
  code: string;
  /** How many people it feeds. */
  servings: number;
  /**
   * The smallest number of servings it can be made at. Omit for 1, which
   * is most recipes. A pie cannot be made for one person however neatly
   * the arithmetic divides.
   */
  min_servings?: number;
  /**
   * How much finished food it makes. Stated, never derived: 300 g of raw
   * rice becomes roughly 750 g cooked because it absorbs water.
   */
  yield: { quantity: number; unit: UnitCode };
  /** The default locale's title is required; every locale here needs one. */
  translations: { es: { title: string; description?: string } } & Partial<
    Record<LocaleCode, { title: string; description?: string }>
  >;
  /**
   * Ordered instructions. Optional: a one-line recipe with no steps - an
   * apple, a glass of milk - is a real entry, and is what the browse list
   * derives "basic" from. Every step must cover exactly the locales the
   * recipe declares, or the recipe would render half in one language.
   */
  steps?: SeedStep[];
  /** At least one. Lines are what a recipe is. */
  lines: SeedRecipeLine[];
  tags?: RecipeTagCode[];
  /**
   * Per-nutrient corrections for what cooking changes, as a TOTAL for the
   * whole recipe. Sticky: they are not recalculated when an ingredient is
   * corrected, because they represent a measurement of the finished dish.
   */
  nutrient_overrides?: Record<string, number>;
};
