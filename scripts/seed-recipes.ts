/**
 * Applies `data/recipes.ts` to an environment.
 *
 * Run deliberately, never automatically in CI:
 *   pnpm run seed:recipes
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
 * environment (`.env.local` for local runs, which points at preprod).
 *
 * Every recipe goes through the `upsert_recipe` RPC rather than a series
 * of table writes, because one recipe spans seven tables and a failure
 * partway must leave none of them changed - and PostgREST gives each call
 * its own transaction, so that guarantee can only come from inside
 * Postgres.
 *
 * The one thing this does that the ingredient seeder does not: it applies
 * the dataset in DEPENDENCY ORDER. `upsert_recipe` resolves sub-recipes by
 * code and raises if one does not exist yet, so a recipe using another
 * must be written after it - and asking a human to keep the file in
 * dependency order by hand is exactly the rule that gets broken silently.
 */

import { createClient } from "@supabase/supabase-js";
import { recipes } from "../data/recipes.ts";
import { ingredients } from "../data/ingredients.ts";
import { validateRecipeDataset, orderByDependency } from "./validate-recipes.ts";

async function main() {
  // Validation runs before the credential check on purpose: checking the
  // dataset is a pure function of the dataset, so it should work with no
  // access to any environment. That makes `node scripts/seed-recipes.ts`
  // usable as a plain "is this data sound?" check.
  const failures = validateRecipeDataset(recipes, ingredients);

  if (failures.length > 0) {
    console.error(`Dataset invalid - nothing was written.\n`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  const ordered = orderByDependency(recipes);
  console.log(`Validated ${recipes.length} recipes.`);

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
  for (const recipe of ordered) {
    const { error } = await supabase.rpc("upsert_recipe", {
      payload: recipe as unknown as Record<string, unknown>,
    });

    if (error) {
      // Stop rather than continue: a failure here means the dataset and
      // the database disagree about something, and pressing on would make
      // it harder to see which recipes actually landed.
      console.error(`\nFailed on "${recipe.code}": ${error.message}`);
      console.error(`${applied} recipe(s) were applied before this point.`);
      process.exit(1);
    }

    applied += 1;
    process.stdout.write(`\r  ${applied}/${ordered.length}`);
  }

  console.log(`\nDone. ${applied} recipes applied.`);

  // The Phase 3b gate, printed on every run rather than written down
  // somewhere nobody looks. Nutrition is computed rather than stored, so
  // it can be added later with no migration - but turning it on is the
  // moment an unconvertible line or a wrong-dimension yield finally
  // surfaces, and finding that across 20 recipes is an afternoon while
  // across 200 it is a curation project.
  if (applied > 25) {
    console.warn(
      `\nThe catalog now holds ${applied} recipes, past the ~25 gate for Phase 3b.\n` +
        "Build the nutrition roll-up before curating further: every recipe written\n" +
        "before it exists is one whose conversions have never been exercised.",
    );
  }

  // Deleting an entry from the dataset would otherwise leave the row in
  // the database forever with nothing anywhere saying so. This reports the
  // difference rather than acting on it: withdrawing a recipe is a
  // decision, and a seed run that silently retired things because someone
  // was mid-edit would be worse than the gap it closes.
  const { data: existing, error: listError } = await supabase
    .from("recipes")
    .select("code")
    .is("retired_at", null);

  if (listError) {
    console.error(`\nCould not check for withdrawn recipes: ${listError.message}`);
    return;
  }

  const inDataset = new Set(recipes.map((recipe) => recipe.code));
  const orphans = existing.map((row) => row.code).filter((code) => !inDataset.has(code));

  if (orphans.length > 0) {
    console.warn(
      `\n${orphans.length} recipe(s) are live in the database but absent from the dataset:`,
    );
    for (const code of orphans) console.warn(`  - ${code}`);
    console.warn(
      "\nIf that is deliberate, withdraw each one with:\n" +
        "  select public.set_recipe_retired('<code>', true);\n" +
        "Retiring hides it from readers without deleting the row, so anything\n" +
        "already referencing it keeps working. Restore with false.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
