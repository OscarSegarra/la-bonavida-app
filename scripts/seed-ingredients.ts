/**
 * Applies `data/ingredients.ts` to an environment.
 *
 * Run deliberately, never automatically in CI:
 *   pnpm run seed:ingredients
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
 * environment (`.env.local` for local runs, which points at preprod).
 *
 * Every ingredient goes through the `upsert_ingredient` RPC rather than a
 * series of table writes, because one ingredient spans six tables and a
 * failure partway must leave none of them changed - and PostgREST gives
 * each call its own transaction, so that guarantee can only come from
 * inside Postgres. See the function's migration for the full reasoning.
 *
 * Validation here is not a substitute for the checks inside that function;
 * it exists to fail on the whole dataset before writing anything, so a
 * typo in entry 40 doesn't leave entries 1-39 applied and the rest not.
 */

import { createClient } from "@supabase/supabase-js";
import { ingredients } from "../data/ingredients.ts";
import type { SeedIngredient, UnitCode } from "../data/ingredient-types.ts";

/**
 * Mirrors `public.units`. Restated here so validation can reason about
 * dimensions without a round trip; the database remains the authority and
 * `upsert_ingredient` rejects anything this misses.
 */
const UNIT_DIMENSION: Record<UnitCode, "mass" | "volume" | "count"> = {
  g: "mass",
  kg: "mass",
  ml: "volume",
  l: "volume",
  unit: "count",
  tbsp: "volume",
  tsp: "volume",
};

/**
 * Checks one entry against the invariants the schema cannot express.
 * @param item The ingredient to check.
 * @returns A list of human-readable problems; empty means valid.
 */
function validate(item: SeedIngredient): string[] {
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

  // The nutrition_basis rule, spelled out: volume-based ingredients are
  // per_100ml, mass- AND count-based ones are per_100g.
  const expectedBasis = dimensions.has("volume") && !dimensions.has("mass")
    ? "per_100ml"
    : dimensions.size === 1 && dimensions.has("count")
      ? "per_100g"
      : null;
  if (expectedBasis && item.nutrition_basis !== expectedBasis) {
    problems.push(
      `nutrition_basis is ${item.nutrition_basis} but its units are ${[...dimensions].join("/")}`,
    );
  }

  // The two bridging values, each required only when its conversion is
  // actually reachable. Without them a quantity in one of these units
  // cannot be turned into the nutrition basis at all.
  if (dimensions.has("mass") && dimensions.has("volume") && item.density_g_per_ml === undefined) {
    problems.push("units span mass and volume but no density_g_per_ml");
  }
  if (dimensions.has("count") && item.grams_per_unit === undefined) {
    problems.push("allows a count unit but no grams_per_unit");
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

async function main() {
  // Validation runs before the credential check on purpose: checking the
  // dataset is a pure function of the dataset, so it should work with no
  // access to any environment. That makes `node scripts/seed-ingredients.ts`
  // usable as a plain "is this data sound?" check.
  const failures: string[] = [];
  const seenCodes = new Set<string>();
  // The database has a unique index on (locale, lower(name)), so two
  // ingredients sharing a name in one language is rejected - but only on
  // the call that happens to hit it, part-way through a run. Catching it
  // here fails the whole dataset before anything is written.
  const seenNames = new Map<string, string>();

  for (const item of ingredients) {
    if (seenCodes.has(item.code)) {
      failures.push(`${item.code}: duplicate code in the dataset`);
    }
    seenCodes.add(item.code);

    for (const [locale, name] of Object.entries(item.names)) {
      const key = `${locale}|${name.trim().toLowerCase()}`;
      const owner = seenNames.get(key);
      if (owner) {
        failures.push(
          `${item.code}: name "${name}" (${locale}) is already used by "${owner}"`,
        );
      }
      seenNames.set(key, item.code);
    }

    for (const problem of validate(item)) {
      failures.push(`${item.code}: ${problem}`);
    }
  }

  if (failures.length > 0) {
    console.error(`Dataset invalid - nothing was written.\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(`Validated ${ingredients.length} ingredients.`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.error(
      "\nMissing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY -\n" +
        "the dataset is valid but nothing was written.\n" +
        "Set them in .env.local (which should point at preprod, never prod).",
    );
    process.exit(1);
  }

  console.log(`Applying to ${url}…`);

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let applied = 0;
  for (const item of ingredients) {
    const { error } = await supabase.rpc("upsert_ingredient", {
      payload: item as unknown as Record<string, unknown>,
    });

    if (error) {
      // Stop rather than continue: a failure here means the dataset and
      // the database disagree about something, and pressing on would make
      // it harder to see which entries actually landed.
      console.error(`\nFailed on "${item.code}": ${error.message}`);
      console.error(`${applied} ingredient(s) were applied before this point.`);
      process.exit(1);
    }

    applied += 1;
    process.stdout.write(`\r  ${applied}/${ingredients.length}`);
  }

  console.log(`\nDone. ${applied} ingredients applied.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
