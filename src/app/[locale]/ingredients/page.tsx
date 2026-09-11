import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  listIngredients,
  listFoodGroups,
  IngredientList,
  IngredientFilters,
} from "@/modules/ingredients";
import { LocaleSwitcher } from "../LocaleSwitcher";

/**
 * Browse the ingredient catalog. Server Component: filters come from the
 * URL and the filtered list is rendered server-side, so a filtered view is
 * shareable and survives a reload.
 * @param params Route params carrying the active locale.
 * @param searchParams `q` (search term) and `group` (food group code),
 * both optional.
 * @returns Redirects to `/login` if signed out - the catalog is global but
 * still readable only by signed-in users. Otherwise the filter controls
 * and the matching list.
 */
export default async function IngredientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; group?: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale });

  const { q, group } = await searchParams;
  const [t, foodGroups, ingredients] = await Promise.all([
    getTranslations("Ingredients"),
    listFoodGroups(supabase),
    listIngredients(supabase, {
      locale,
      defaultLocale: routing.defaultLocale,
      search: q,
      foodGroupCode: group,
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

      <IngredientFilters foodGroups={foodGroups} search={q} foodGroup={group} />

      <IngredientList
        ingredients={ingredients}
        hasFilters={Boolean(q?.trim() || group)}
      />
    </div>
  );
}
