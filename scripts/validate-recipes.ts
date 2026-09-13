/**
 * Checks the recipe dataset, and works out what order to apply it in.
 *
 * Separate from `seed-recipes.ts` so it can be imported and tested without
 * running a seed: that script calls `main()` at module scope, so importing
 * it would write to a database.
 *
 * None of this replaces the checks inside `upsert_recipe`. It exists so
 * the whole dataset fails before anything is written, rather than entry 6
 * failing with entries 1-5 already applied - and so that a typo is a
 * message naming the recipe rather than a Postgres error naming a column.
 */

import type { SeedRecipe } from "../data/recipe-types.ts";
import type { SeedIngredient } from "../data/ingredient-types.ts";
import { UNIT_DIMENSION } from "./validate-ingredients.ts";

/** The locale every recipe must be written in; the rest are optional. */
const DEFAULT_LOCALE = "es";

/**
 * Checks one recipe against the invariants the schema cannot express.
 *
 * Ingredient codes are checked against the actual ingredient dataset
 * rather than a hand-copied union, because a union is one more place to
 * forget when an ingredient is added, and it would go stale silently.
 * @param recipe The recipe to check.
 * @param ingredientsByCode Every ingredient in the catalog dataset.
 * @param recipeCodes Every code in the recipe dataset, for sub-recipes.
 * @returns A list of human-readable problems; empty means valid.
 */
export function validateRecipe(
  recipe: SeedRecipe,
  ingredientsByCode: Map<string, SeedIngredient>,
  recipeCodes: Set<string>,
): string[] {
  const problems: string[] = [];

  if (!recipe.translations[DEFAULT_LOCALE]?.title?.trim()) {
    problems.push(`no ${DEFAULT_LOCALE} title (the default locale is required)`);
  }

  // The locales this recipe claims to exist in. Every step must cover
  // exactly these: per-step fallback would otherwise produce a recipe that
  // reads in Catalan for four steps and Spanish for the fifth, which is
  // valid to the database and visibly broken to a person.
  const locales = Object.entries(recipe.translations)
    .filter(([, value]) => value?.title?.trim())
    .map(([locale]) => locale)
    .sort();

  (recipe.steps ?? []).forEach((step, index) => {
    const stepLocales = Object.entries(step)
      .filter(([, body]) => body?.trim())
      .map(([locale]) => locale)
      .sort();

    if (stepLocales.join(",") !== locales.join(",")) {
      problems.push(
        `step ${index + 1} covers [${stepLocales.join(", ")}] but the recipe declares ` +
          `[${locales.join(", ")}] - every step must exist in every language the recipe does`,
      );
    }
  });

  if (recipe.lines.length === 0) {
    problems.push("no lines - a recipe with no ingredients is not a recipe");
  }

  if (recipe.min_servings !== undefined && recipe.min_servings > recipe.servings) {
    problems.push(
      `min_servings (${recipe.min_servings}) is above servings (${recipe.servings})`,
    );
  }

  for (const [index, line] of recipe.lines.entries()) {
    const named = [line.ingredient, line.recipe].filter(Boolean).length;
    if (named !== 1) {
      problems.push(
        `line ${index + 1} names ${named} targets - it must name exactly one of ` +
          `"ingredient" or "recipe"`,
      );
      continue;
    }

    if (line.quantity === undefined || line.quantity <= 0) {
      problems.push(
        `line ${index + 1} has a quantity of ${line.quantity} - there is no "to taste", ` +
          `put the wording in a step and a real number here`,
      );
    }

    if (line.ingredient !== undefined) {
      const ingredient = ingredientsByCode.get(line.ingredient);
      if (!ingredient) {
        problems.push(`line ${index + 1} names unknown ingredient "${line.ingredient}"`);
        continue;
      }

      // The database enforces this too, at commit. Catching it here means
      // the message names the recipe and the line rather than arriving as
      // a constraint violation halfway through a seed run.
      if (!ingredient.units.allowed.includes(line.unit)) {
        problems.push(
          `line ${index + 1} measures "${line.ingredient}" in ${line.unit}, which is not ` +
            `one of its allowed units (${ingredient.units.allowed.join(", ")})`,
        );
      }
    }

    if (line.recipe !== undefined && !recipeCodes.has(line.recipe)) {
      problems.push(`line ${index + 1} names unknown sub-recipe "${line.recipe}"`);
    }
  }

  return problems;
}

/**
 * Orders the dataset so a recipe is always applied after any recipe it
 * uses as a sub-recipe.
 *
 * `upsert_recipe` resolves sub-recipes by code and raises if one does not
 * exist yet, so the importer cannot simply apply the file top to bottom -
 * and requiring a human to keep the file in dependency order by hand is
 * exactly the kind of rule that gets broken silently.
 * @param recipes The dataset, in any order.
 * @returns The same recipes, dependencies first.
 * @throws If the dataset contains a cycle, naming the recipes involved.
 */
export function orderByDependency(recipes: SeedRecipe[]): SeedRecipe[] {
  const byCode = new Map(recipes.map((r) => [r.code, r]));
  const ordered: SeedRecipe[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  function visit(recipe: SeedRecipe, trail: string[]): void {
    if (done.has(recipe.code)) return;

    // A cycle is caught here rather than by the database trigger, so the
    // error names the whole path instead of one edge.
    if (visiting.has(recipe.code)) {
      throw new Error(
        `recipe dependency cycle: ${[...trail, recipe.code].join(" -> ")}`,
      );
    }

    visiting.add(recipe.code);
    for (const line of recipe.lines) {
      // An unknown sub-recipe is the validator's problem to report, not
      // this function's - skipping it here keeps the two messages from
      // competing over the same mistake.
      const child = line.recipe === undefined ? undefined : byCode.get(line.recipe);
      if (child) visit(child, [...trail, recipe.code]);
    }
    visiting.delete(recipe.code);

    done.add(recipe.code);
    ordered.push(recipe);
  }

  for (const recipe of recipes) visit(recipe, []);
  return ordered;
}

/**
 * Checks a whole dataset: every recipe, plus the rules that only exist
 * between recipes.
 * @param recipes The full recipe dataset.
 * @param ingredients The full ingredient dataset, for cross-checking codes.
 * @returns Problems prefixed with the offending code; empty means valid.
 */
export function validateRecipeDataset(
  recipes: SeedRecipe[],
  ingredients: SeedIngredient[],
): string[] {
  const failures: string[] = [];
  const ingredientsByCode = new Map(ingredients.map((i) => [i.code, i]));
  const recipeCodes = new Set(recipes.map((r) => r.code));
  const seenCodes = new Set<string>();
  const seenTitles = new Map<string, string>();

  for (const recipe of recipes) {
    if (seenCodes.has(recipe.code)) {
      failures.push(`${recipe.code}: duplicate code in the dataset`);
    }
    seenCodes.add(recipe.code);

    for (const [locale, value] of Object.entries(recipe.translations)) {
      const title = value?.title?.trim();
      if (!title) continue;
      const key = `${locale}|${title.toLowerCase()}`;
      const owner = seenTitles.get(key);
      if (owner) {
        failures.push(
          `${recipe.code}: title "${title}" (${locale}) is already used by "${owner}"`,
        );
      }
      seenTitles.set(key, recipe.code);
    }

    for (const problem of validateRecipe(recipe, ingredientsByCode, recipeCodes)) {
      failures.push(`${recipe.code}: ${problem}`);
    }
  }

  // A cycle makes ordering impossible, so it is reported as a dataset
  // failure rather than thrown at the importer.
  try {
    orderByDependency(recipes);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  return failures;
}

export { UNIT_DIMENSION };
