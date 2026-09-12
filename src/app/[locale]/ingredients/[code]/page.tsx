import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { NutritionTable } from "@/lib/nutrition/NutritionTable";
import { getIngredient, IngredientFacts } from "@/modules/ingredients";

/**
 * One ingredient's detail page. Server Component.
 *
 * Keyed on the ingredient's `code`, not its id: `code` is the stable
 * identity, so a bookmarked or shared URL keeps working after the catalog
 * is re-seeded into a fresh environment, where surrogate ids would differ.
 * @param params Route params - `code` is the ingredient's slug, `locale`
 * the active language.
 * @returns Redirects to `/login` if signed out; 404s if no such code
 * exists; otherwise the ingredient's nutrition and facts.
 */
export default async function IngredientPage({
  params,
}: {
  params: Promise<{ code: string; locale: string }>;
}) {
  const { code, locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale });

  const [ingredient, t, tGroups] = await Promise.all([
    getIngredient(supabase, code, {
      locale,
      defaultLocale: routing.defaultLocale,
    }),
    getTranslations("Ingredients"),
    getTranslations("foodGroups"),
  ]);

  if (!ingredient) notFound();

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <Link
        href="/ingredients"
        className="text-sm text-zinc-500 dark:text-zinc-400"
      >
        {t("backToList")}
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          {ingredient.name}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {tGroups(ingredient.foodGroupCode)}
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("nutrition")}
        </h2>
        <NutritionTable
          values={ingredient.nutrients}
          basis={ingredient.nutritionBasis}
          emptyMessage={t("noNutrition")}
        />
      </section>

      <IngredientFacts ingredient={ingredient} />
    </div>
  );
}
