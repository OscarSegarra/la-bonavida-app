import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listRecipes, listRecipeTags, RecipeList, RecipeFilters } from "@/modules/recipes";
import { LocaleSwitcher } from "../LocaleSwitcher";

/**
 * Browse the recipe catalog. Server Component: filters come from the URL
 * and the filtered list is rendered server-side, so a filtered view is
 * shareable and survives a reload.
 * @param params Route params carrying the active locale.
 * @param searchParams `q` (search term), `tag` (tag code) and `basics`
 * (show single-ingredient entries), all optional.
 * @returns Redirects to `/login` if signed out — the catalog is global but
 * still readable only by signed-in users. Otherwise the filter controls
 * and the matching list.
 */
export default async function RecipesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; tag?: string; basics?: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale });

  const { q, tag, basics } = await searchParams;
  const includeBasics = basics === "1";

  const [t, tags, recipes] = await Promise.all([
    getTranslations("Recipes"),
    listRecipeTags(supabase),
    listRecipes(supabase, {
      locale,
      defaultLocale: routing.defaultLocale,
      search: q,
      tagCode: tag,
      includeBasics,
    }),
  ]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          {t("title")}
        </h1>
        <LocaleSwitcher />
      </div>

      {/*
        Curated-for-now is a deliberate decision, and a page with no "add"
        button and no explanation reads as broken or unfinished rather than
        intentional.
      */}
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("curatedNote")}</p>

      <RecipeFilters tags={tags} search={q} tag={tag} includeBasics={includeBasics} />

      <RecipeList recipes={recipes} hasFilters={Boolean(q?.trim() || tag)} />
    </div>
  );
}
