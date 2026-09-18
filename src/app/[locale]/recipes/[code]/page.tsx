import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getRecipe, RecipeLines, RecipeSteps } from "@/modules/recipes";

/**
 * One recipe's page. Server Component, with the two genuinely interactive
 * pieces — the serving-size picker and the step checklist — as small
 * Client Components inside it.
 *
 * Keyed on the recipe's `code`, not its id: `code` is the stable identity,
 * so a bookmarked or shared URL keeps working after the catalog is
 * re-seeded into a fresh environment, where surrogate ids would differ.
 *
 * The yield is deliberately not shown. It is plumbing for sub-recipe
 * arithmetic, and "Serves 4" beside "Yield 750 g" only invites the
 * question of which one matters.
 * @param params Route params — `code` is the recipe's slug, `locale` the
 * active language.
 * @returns Redirects to `/login` if signed out; 404s if no such code
 * exists or the recipe has been retired.
 */
export default async function RecipePage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale });

  const [t, tTags, tDietary, recipe] = await Promise.all([
    getTranslations("Recipes"),
    getTranslations("recipeTags"),
    getTranslations("dietaryTags"),
    getRecipe(supabase, code, { locale, defaultLocale: routing.defaultLocale }),
  ]);

  if (!recipe) notFound();

  const allergens = recipe.dietaryFacts.filter((fact) => fact.category === "allergen");
  const diets = recipe.dietaryFacts.filter((fact) => fact.category === "diet");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <Link
        href="/recipes"
        className="text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        {t("backToList")}
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          {recipe.title}
          {recipe.isFallbackTitle && (
            <span className="ml-2 text-xs text-zinc-400" title="es">
              (es)
            </span>
          )}
        </h1>
        {recipe.description && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{recipe.description}</p>
        )}
        {recipe.tagCodes.length > 0 && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {recipe.tagCodes.map((tag) => tTags(tag)).join(" · ")}
          </p>
        )}
      </div>

      {/*
        Derived from the ingredients, never typed by hand, so these cannot
        contradict the recipe they are on. Allergens are shown even when
        there are none, because "no allergens listed" and "we did not
        check" have to look different to someone who needs to know.
      */}
      <section className="flex flex-col gap-1 rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10">
        <p className="text-black dark:text-zinc-50">
          <span className="text-zinc-500 dark:text-zinc-400">{t("allergens")}: </span>
          {allergens.length > 0
            ? allergens.map((fact) => tDietary(fact.code)).join(", ")
            : t("noAllergens")}
        </p>
        {diets.length > 0 && (
          <p className="text-black dark:text-zinc-50">
            <span className="text-zinc-500 dark:text-zinc-400">{t("suitableFor")}: </span>
            {diets.map((fact) => tDietary(fact.code)).join(", ")}
          </p>
        )}
      </section>

      <RecipeLines
        servings={recipe.servings}
        minServings={recipe.minServings}
        lines={recipe.lines}
      />

      <RecipeSteps recipeCode={recipe.code} steps={recipe.steps} />
    </div>
  );
}
