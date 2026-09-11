import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { IngredientSummary } from "../data/ingredients";

/**
 * The browse list. Server Component - nothing here is interactive.
 * @param ingredients The ingredients to show, already filtered and sorted.
 * @param hasFilters Whether a search or group filter is active, which
 * decides between "nothing matched" and "the catalog is empty".
 * @returns A list of links to each ingredient's detail page.
 */
export function IngredientList({
  ingredients,
  hasFilters,
}: {
  ingredients: IngredientSummary[];
  hasFilters: boolean;
}) {
  const t = useTranslations("Ingredients");
  const tGroups = useTranslations("foodGroups");

  if (ingredients.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {hasFilters ? t("noResults") : t("empty")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {t("count", { count: ingredients.length })}
      </p>
      <ul className="flex flex-col gap-2">
        {ingredients.map((ingredient) => (
          <li key={ingredient.code}>
            <Link
              href={`/ingredients/${ingredient.code}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-black/10 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-zinc-900"
            >
              <span className="text-black dark:text-zinc-50">
                {ingredient.name}
                {/*
                  Marks a name shown in the default language because this
                  one has not been translated yet. Without it the catalog
                  looks half-broken rather than partly translated.
                */}
                {ingredient.isFallbackName && (
                  <span className="ml-2 text-xs text-zinc-400" title="es">
                    (es)
                  </span>
                )}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {tGroups(ingredient.foodGroupCode)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
