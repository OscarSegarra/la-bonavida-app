"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { offeredSizes, scaleQuantity } from "../domain/scaling";
import type { RecipeLine } from "../data/recipes";

/**
 * A recipe's ingredients, with the control that scales them.
 *
 * The picker and the list are one component because the list changes with
 * the picker and neither is useful alone. This is the interactive piece
 * the page is otherwise a Server Component around.
 *
 * Every size offered here is one where nothing comes out as a fraction of
 * something indivisible - the filtering happens in `domain/scaling`, so
 * nothing is rounded on the way to the screen and every number shown is
 * exact. A recipe using one egg for four people simply offers no smaller
 * size, which is honest rather than unhelpful.
 * @param recipeCode The recipe, for linking a sub-recipe line onward.
 * @param servings The recipe's own serving count.
 * @param minServings The smallest size it can be made at.
 * @param lines The lines in order, resolved to the reader's language.
 * @returns The size picker and the scaled ingredient list.
 */
export function RecipeLines({
  servings,
  minServings,
  lines,
}: {
  servings: number;
  minServings: number;
  lines: RecipeLine[];
}) {
  const t = useTranslations("Recipes");
  const tUnits = useTranslations("units");
  const locale = useLocale();
  const [target, setTarget] = useState(servings);

  const sizes = offeredSizes({
    servings,
    minServings,
    lines: lines.map((line) => ({
      quantity: line.quantity,
      dimension: line.dimension,
      countDivisible: line.countDivisible,
    })),
  });

  // Quantities are numbers, and numbers are written differently per
  // language: 1,5 in Spanish and Catalan, 1.5 in English. maximumFraction
  // Digits of 2 is enough for the halves and thirds the offered sizes can
  // produce, and it trims the trailing zeros a plain toFixed would leave.
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("ingredients")}
        </h2>

        {/*
          A short list of sizes rather than a free number input. Only the
          counts where every line stays usable are here at all, which is
          what makes "half an egg" impossible to reach rather than merely
          discouraged.
        */}
        <label className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">{t("servings")}</span>
          <select
            value={target}
            onChange={(event) => setTarget(Number(event.target.value))}
            className="rounded-md border border-black/10 bg-white px-2 py-1 text-black dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {sizes.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="flex flex-col gap-2">
        {lines.map((line) => {
          const quantity = scaleQuantity(line.quantity, servings, target);
          const amount = `${format.format(quantity)} ${tUnits(line.unitCode)}`;

          return (
            <li
              key={line.position}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10"
            >
              {/*
                Both kinds of line link onward: naming something the app
                has a page for and not linking to it is a dead end. A
                sub-recipe line is marked, because "200 g of cooked rice"
                being itself a recipe is not obvious from the name alone.
              */}
              {line.ingredient && (
                <Link
                  href={`/ingredients/${line.ingredient.code}`}
                  className="text-black underline-offset-2 hover:underline dark:text-zinc-50"
                >
                  {line.ingredient.name}
                </Link>
              )}
              {line.subRecipe && (
                <Link
                  href={`/recipes/${line.subRecipe.code}`}
                  className="text-black underline-offset-2 hover:underline dark:text-zinc-50"
                >
                  {line.subRecipe.title}
                  <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {t("isARecipe")}
                  </span>
                </Link>
              )}
              <span className="text-zinc-600 dark:text-zinc-300">{amount}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
