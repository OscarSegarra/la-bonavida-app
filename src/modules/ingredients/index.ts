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

// Nutrient formatting and the NutritionTable used to be re-exported from
// here. They are not this module's to publish: nutrients are shared
// reference data like units and locales, so they live in src/lib/nutrition
// and every module imports them directly. Same reasoning that removed
// listUnits() from this connector during the Phase 2 review.
export { groupMonthsIntoRuns } from "./domain/seasonality";

export { resolveTranslation } from "./domain/translations";
export type { Translation, ResolvedName } from "./domain/translations";

export { convertQuantity } from "./domain/units";
export type { UnitInfo, Dimension, Bridges } from "./domain/units";

export { IngredientList } from "./ui/IngredientList";
export { IngredientFilters } from "./ui/IngredientFilters";
export { IngredientFacts } from "./ui/IngredientFacts";
