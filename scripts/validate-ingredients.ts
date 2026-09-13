/**
 * Checks the seed dataset against the invariants the schema cannot express.
 *
 * Separate from `seed-ingredients.ts` so it can be imported and tested
 * without running a seed: that script calls `main()` at module scope, so
 * importing it would write to a database. Validation is a pure function of
 * the dataset and deserves to be exercised directly, particularly now that
 * it is the only layer enforcing EU-mandatory nutrient completeness.
 *
 * None of this replaces the checks inside `upsert_ingredient`. It exists so
 * the whole dataset fails before anything is written, rather than entry 40
 * failing with entries 1-39 already applied.
 */

import type { SeedIngredient, UnitCode } from "../data/ingredient-types.ts";

/**
 * Mirrors `public.units`. Restated here so validation can reason about
 * dimensions without a round trip; the database remains the authority and
 * `upsert_ingredient` rejects anything this misses.
 *
 * Drift is caught by the type, not by discipline: `Record<UnitCode, ...>`
 * will not compile if a unit is added to `UnitCode` and forgotten here.
 */
export const UNIT_DIMENSION: Record<UnitCode, "mass" | "volume" | "count"> = {
  g: "mass",
  kg: "mass",
  ml: "volume",
  l: "volume",
  unit: "count",
  tbsp: "volume",
  tsp: "volume",
};

/**
 * The nutrients EU Regulation 1169/2011 requires on every label, mirroring
 * `public.nutrients where eu_mandatory`.
 *
 * These are required rather than merely expected. Everything else in the
 * vocabulary is optional - nutrition data is sparse by design, and an
 * ingredient with no known vitamins is a normal ingredient. These eight
 * are the exception: an entry missing them is not sparse, it is
 * incomplete, and it would render a declaration no European label is
 * allowed to print.
 *
 * Nothing else enforces this. The schema cannot (the rule is about which
 * rows exist, not about any one row), and `upsert_ingredient` only checks
 * that the codes it is handed resolve. That all 62 seeded ingredients were
 * complete was curation luck, not a guarantee - a review probe wrote one
 * carrying a single nutrient and every layer accepted it.
 *
 * Energy appears twice on purpose: a label states it in both kJ and kcal.
 */
export const EU_MANDATORY_NUTRIENTS = [
  "energy_kj",
  "energy_kcal",
  "fat",
  "saturates",
  "carbohydrate",
  "sugars",
  "protein",
  "salt",
] as const;

/**
 * Checks one entry against the invariants the schema cannot express.
 * @param item The ingredient to check.
 * @returns A list of human-readable problems; empty means valid.
 */
export function validateIngredient(item: SeedIngredient): string[] {
  const problems: string[] = [];

  if (!item.names.es?.trim()) {
    problems.push("no Spanish name (the default locale is required)");
  }

  const allowed = item.units.allowed;
  if (allowed.length === 0) {
    problems.push("no allowed units");
  }
  if (!allowed.includes(item.units.default)) {
    problems.push(`default unit "${item.units.default}" is not in the allowed list`);
  }
  if (new Set(allowed).size !== allowed.length) {
    problems.push("duplicate entries in the allowed units");
  }

  const dimensions = new Set(allowed.map((u) => UNIT_DIMENSION[u]));

  // The nutrition_basis rule: the DEFAULT unit's dimension decides. Volume
  // gives per_100ml, mass and count both give per_100g.
  //
  // An earlier version asked whether *any* allowed unit was volume, which
  // reclassified milk and olive oil - both declared per 100 ml, both also
  // measurable in grams. Worse, it returned null for that case and skipped
  // the check entirely, so the inconsistency validated clean. Deciding on
  // the default unit is well defined for every ingredient, eggs included.
  const defaultDimension = UNIT_DIMENSION[item.units.default];
  const expectedBasis = defaultDimension === "volume" ? "per_100ml" : "per_100g";
  if (item.nutrition_basis !== expectedBasis) {
    problems.push(
      `nutrition_basis is ${item.nutrition_basis} but its default unit "${item.units.default}" is ${defaultDimension}, which implies ${expectedBasis}`,
    );
  }

  // The two bridging values, each required only when its conversion is
  // actually reachable. Without them a quantity in one of these units
  // cannot be turned into the nutrition basis at all.
  //
  // A density is needed whenever volume sits alongside ANY other
  // dimension, not only mass. An earlier version asked for mass AND
  // volume, which missed count+volume - an ingredient allowing "unit" and
  // "ml" converts count -> grams -> volume, so it needs a density too, and
  // would have validated clean without one. No ingredient in the dataset
  // reaches that combination today, which is exactly why it was easy to
  // miss and worth closing before one does.
  if (
    dimensions.has("volume") &&
    (dimensions.has("mass") || dimensions.has("count")) &&
    item.density_g_per_ml === undefined
  ) {
    problems.push("units cross between volume and another dimension but no density_g_per_ml");
  }
  if (dimensions.has("count") && item.grams_per_unit === undefined) {
    problems.push("allows a count unit but no grams_per_unit");
  }

  // Divisibility is required exactly where a count unit is allowed, and
  // forbidden elsewhere. Both halves matter: without the first, a new
  // count-based ingredient would silently default to something, and the
  // default that reads as harmless (divisible) is the one that puts half
  // an egg back on screen. Without the second, the field spreads to
  // ingredients nobody counts, where it means nothing and will eventually
  // be believed by something.
  if (dimensions.has("count") && item.count_divisible === undefined) {
    problems.push(
      "allows a count unit but no count_divisible - say whether half of one is usable",
    );
  }
  if (!dimensions.has("count") && item.count_divisible !== undefined) {
    problems.push("has count_divisible but allows no count unit, where it means nothing");
  }

  const missingMandatory = EU_MANDATORY_NUTRIENTS.filter(
    (code) => item.nutrients[code] === undefined,
  );
  if (missingMandatory.length > 0) {
    problems.push(
      `missing EU-mandatory nutrient(s): ${missingMandatory.join(", ")} - ` +
        "every one of the eight must be present, using 0 where the value really is zero",
    );
  }

  if (item.density_g_per_ml !== undefined && item.density_g_per_ml <= 0) {
    problems.push("density_g_per_ml must be positive");
  }
  if (item.grams_per_unit !== undefined && item.grams_per_unit <= 0) {
    problems.push("grams_per_unit must be positive");
  }

  for (const [code, amount] of Object.entries(item.nutrients)) {
    if (typeof amount !== "number" || Number.isNaN(amount) || amount < 0) {
      problems.push(`nutrient "${code}" has a negative or non-numeric amount`);
    }
  }

  for (const [region, months] of Object.entries(item.seasonality ?? {})) {
    if (months.length === 0) {
      problems.push(`seasonality for "${region}" is an empty list - omit it instead`);
    }
    for (const month of months) {
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        problems.push(`seasonality for "${region}" has an invalid month: ${month}`);
      }
    }
    if (new Set(months).size !== months.length) {
      problems.push(`seasonality for "${region}" repeats a month`);
    }
  }

  return problems;
}

/**
 * Checks a whole dataset: every entry, plus the rules that only exist
 * between entries.
 * @param items The full seed dataset.
 * @returns Problems prefixed with the offending code; empty means valid.
 */
export function validateDataset(items: SeedIngredient[]): string[] {
  const failures: string[] = [];
  const seenCodes = new Set<string>();
  // The database has a unique index on (locale, lower(name)), so two
  // ingredients sharing a name in one language is rejected - but only on
  // the call that happens to hit it, part-way through a run. Catching it
  // here fails the whole dataset before anything is written.
  const seenNames = new Map<string, string>();

  for (const item of items) {
    if (seenCodes.has(item.code)) {
      failures.push(`${item.code}: duplicate code in the dataset`);
    }
    seenCodes.add(item.code);

    for (const [locale, name] of Object.entries(item.names)) {
      const key = `${locale}|${name.trim().toLowerCase()}`;
      const owner = seenNames.get(key);
      if (owner) {
        failures.push(`${item.code}: name "${name}" (${locale}) is already used by "${owner}"`);
      }
      seenNames.set(key, item.code);
    }

    for (const problem of validateIngredient(item)) {
      failures.push(`${item.code}: ${problem}`);
    }
  }

  return failures;
}
