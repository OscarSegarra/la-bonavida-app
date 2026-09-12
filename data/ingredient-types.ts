/**
 * The shape of the seed dataset, typed against the vocabularies the
 * migrations seed.
 *
 * These unions deliberately restate what is already in the database. That
 * is not redundancy for its own sake: it moves a mistyped food group,
 * nutrient or unit from a runtime error raised by `upsert_ingredient` to a
 * compile error caught by `pnpm run typecheck` in CI - before anyone runs
 * the importer against an environment. The function still validates at
 * runtime, because the database cannot trust a client.
 */

export type LocaleCode = "es" | "ca" | "en";

export type RegionCode = "es";

export type FoodGroupCode =
  | "hortalizas"
  | "frutas"
  | "patatas_tuberculos"
  | "cereales"
  | "legumbres"
  | "frutos_secos"
  | "pescado_marisco"
  | "huevos"
  | "lacteos"
  | "carne"
  | "aceite_oliva"
  | "agua"
  | "limitar";

export type UnitCode = "g" | "kg" | "ml" | "l" | "unit" | "tbsp" | "tsp";

export type NutrientCode =
  | "energy_kj"
  | "energy_kcal"
  | "fat"
  | "saturates"
  | "monounsaturates"
  | "polyunsaturates"
  | "carbohydrate"
  | "sugars"
  | "polyols"
  | "starch"
  | "fibre"
  | "protein"
  | "salt"
  | "vitamin_a"
  | "vitamin_d"
  | "vitamin_e"
  | "vitamin_k"
  | "vitamin_c"
  | "thiamin"
  | "riboflavin"
  | "niacin"
  | "vitamin_b6"
  | "folic_acid"
  | "vitamin_b12"
  | "biotin"
  | "pantothenic_acid"
  | "potassium"
  | "chloride"
  | "calcium"
  | "phosphorus"
  | "magnesium"
  | "iron"
  | "zinc"
  | "copper"
  | "manganese"
  | "fluoride"
  | "selenium"
  | "chromium"
  | "molybdenum"
  | "iodine";

export type DietaryTagCode =
  | "gluten"
  | "crustaceans"
  | "eggs"
  | "fish"
  | "peanuts"
  | "soybeans"
  | "milk"
  | "nuts"
  | "celery"
  | "mustard"
  | "sesame"
  | "sulphites"
  | "lupin"
  | "molluscs"
  | "vegetarian"
  | "vegan";

export type SeedIngredient = {
  /** Stable identity. Never a name - names are per-locale and vary. */
  code: string;
  food_group: FoodGroupCode;
  /** Volume-based ingredients are per_100ml; mass- and count-based are per_100g. */
  nutrition_basis: "per_100g" | "per_100ml";
  /** Required when allowed units span both mass and volume. Approximate. */
  density_g_per_ml?: number;
  /** Required when a count unit is allowed (1 egg ~ 58 g). Approximate. */
  grams_per_unit?: number;
  /**
   * Whether a fraction of one is a real thing a person can use: half an
   * onion yes, half an egg no. Required exactly when a count unit is
   * allowed, and must be absent otherwise - the question is meaningless
   * for something nobody counts.
   *
   * It decides which serving sizes a recipe can offer: rather than
   * rounding a scaled quantity, a size is simply not offered when it
   * would need half of something indivisible.
   */
  count_divisible?: boolean;
  /** The default locale's name is required; the others are optional and fall back. */
  names: { es: string } & Partial<Record<LocaleCode, string>>;
  /** Sparse by design - only what is actually known for this ingredient. */
  nutrients: Partial<Record<NutrientCode, number>>;
  dietary_tags: DietaryTagCode[];
  units: { allowed: UnitCode[]; default: UnitCode };
  /** In-season months per region. Absent means "not tracked as seasonal here". */
  seasonality?: Partial<Record<RegionCode, number[]>>;
};
