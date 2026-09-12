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
import { validateDataset } from "./validate-ingredients.ts";

async function main() {
  // Validation runs before the credential check on purpose: checking the
  // dataset is a pure function of the dataset, so it should work with no
  // access to any environment. That makes `node scripts/seed-ingredients.ts`
  // usable as a plain "is this data sound?" check.
  const failures = validateDataset(ingredients);

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

  // Deleting an entry from the dataset used to leave the row in the
  // database forever, with nothing anywhere saying so. This reports the
  // difference rather than acting on it: withdrawing an ingredient is a
  // decision, and a seed run that silently retired things because someone
  // was mid-edit would be worse than the gap it closes.
  //
  // Retired ingredients are excluded because they are the expected steady
  // state after someone acts on this - otherwise the same warning would
  // reappear on every run forever.
  const { data: existing, error: listError } = await supabase
    .from("ingredients")
    .select("code")
    .is("retired_at", null);

  if (listError) {
    console.error(`\nCould not check for withdrawn ingredients: ${listError.message}`);
    return;
  }

  const inDataset = new Set(ingredients.map((item) => item.code));
  const orphans = existing.map((row) => row.code).filter((code) => !inDataset.has(code));

  if (orphans.length > 0) {
    console.warn(
      `\n${orphans.length} ingredient(s) are live in the database but absent from the dataset:`,
    );
    for (const code of orphans) console.warn(`  - ${code}`);
    console.warn(
      "\nIf that is deliberate, withdraw each one with:\n" +
        "  select public.set_ingredient_retired('<code>', true);\n" +
        "Retiring hides it from readers without deleting the row, so anything\n" +
        "already referencing it keeps working. Restore with false.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
