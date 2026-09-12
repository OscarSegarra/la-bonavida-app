import { useTranslations } from "next-intl";
import { groupMonthsIntoRuns } from "../domain/nutrition";
import type { IngredientDetail } from "../data/ingredients";

/**
 * The non-nutrition half of an ingredient's detail page: allergen and diet
 * tags, the units it can be measured in, and its season.
 * @param ingredient The ingredient being shown.
 * @returns Three small sections, each degrading to an explanatory note
 * when there is nothing to show.
 */
export function IngredientFacts({ ingredient }: { ingredient: IngredientDetail }) {
  const t = useTranslations("Ingredients");
  const tTags = useTranslations("dietaryTags");
  const tUnits = useTranslations("units");
  const tRegions = useTranslations("regions");
  const tMonths = useTranslations("months");

  const allergens = ingredient.dietaryTags.filter((tag) => tag.category === "allergen");
  const diets = ingredient.dietaryTags.filter((tag) => tag.category === "diet");

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("allergensAndDiets")}
        </h2>
        {ingredient.dietaryTags.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noTags")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {/*
              Allergens are styled distinctly from diet labels: one is a
              safety fact and the other a preference, and a list that
              renders "Milk" and "Vegetarian" identically invites reading
              an allergen as a lifestyle tag.
            */}
            {allergens.map((tag) => (
              <li
                key={tag.code}
                className="rounded-full border border-red-600/30 px-2 py-0.5 text-xs text-red-700 dark:text-red-400"
              >
                {tTags(tag.code)}
              </li>
            ))}
            {diets.map((tag) => (
              <li
                key={tag.code}
                className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-400"
              >
                {tTags(tag.code)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("units")}
        </h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {ingredient.allowedUnits.map((unit) => (
            <li
              key={unit.code}
              className="rounded-md border border-black/10 px-2 py-0.5 text-xs dark:border-white/10"
            >
              {tUnits(unit.code)}
              {unit.isDefault && (
                <span className="ml-1 text-zinc-400">({t("defaultUnit")})</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("season")}
        </h2>
        {ingredient.seasonality.length === 0 ? (
          // Deliberately ambiguous: no rows covers both "available all
          // year" and "never grown here". Telling those apart is a local
          // sourcing question, and is not what this data records.
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("noSeason")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {ingredient.seasonality.map((entry) => (
              <li key={entry.regionCode} className="text-black dark:text-zinc-50">
                <span className="text-zinc-500 dark:text-zinc-400">
                  {tRegions(entry.regionCode)}:{" "}
                </span>
                {groupMonthsIntoRuns(entry.months)
                  .map(([from, to]) =>
                    from === to
                      ? tMonths(String(from))
                      : `${tMonths(String(from))} – ${tMonths(String(to))}`,
                  )
                  .join(", ")}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
