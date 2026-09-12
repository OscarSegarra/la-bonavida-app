/**
 * Connector for the `ingredients` module.
 *
 * This is the ONLY file other modules are allowed to import from. Everything
 * under domain/, data/, and ui/ is private to this module — enforced by the
 * boundaries ESLint rule in eslint.config.mjs, not just by convention.
 *
 * Note what is deliberately absent: nothing here writes. The catalog is
 * admin-curated, so its only write path is the `upsert_ingredient` database
 * function called by the seed script — never the app.
 */

export {
  listIngredients,
  getIngredient,
  listFoodGroups,
  listDietaryTags,
} from "./data/ingredients";
export type { IngredientSummary, IngredientDetail } from "./data/ingredients";

export {
  groupNutrientsByCategory,
  formatNutrientAmount,
  groupMonthsIntoRuns,
} from "./domain/nutrition";
export type { NutrientValue, NutrientGroup, NutrientCategory } from "./domain/nutrition";

export { resolveTranslation } from "./domain/translations";
export type { Translation, ResolvedName } from "./domain/translations";

export { convertQuantity } from "./domain/units";
export type { UnitInfo, Dimension, Bridges } from "./domain/units";

export { IngredientList } from "./ui/IngredientList";
export { IngredientFilters } from "./ui/IngredientFilters";
export { NutritionTable } from "./ui/NutritionTable";
export { IngredientFacts } from "./ui/IngredientFacts";
