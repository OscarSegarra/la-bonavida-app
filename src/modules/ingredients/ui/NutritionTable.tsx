import { useTranslations } from "next-intl";
import {
  groupNutrientsByCategory,
  formatNutrientAmount,
  type NutrientValue,
} from "../domain/nutrition";

/**
 * Renders an ingredient's nutrition declaration.
 *
 * Sub-declarations ("of which saturates") are indented rather than given
 * their own row heading, matching how a real label reads. Which rows exist
 * at all is driven entirely by the data: nutrition is sparse by design, so
 * an ingredient with only the mandatory seven shows seven rows and no
 * empty vitamin section.
 * @param values The ingredient's known nutrient values.
 * @param basis Whether the amounts are per 100 g or per 100 ml.
 * @returns A table, or a note when nothing is known.
 */
export function NutritionTable({
  values,
  basis,
}: {
  values: NutrientValue[];
  basis: "per_100g" | "per_100ml";
}) {
  const t = useTranslations("Ingredients");
  const tNutrients = useTranslations("nutrients");

  if (values.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {t("noNutrition")}
      </p>
    );
  }

  const groups = groupNutrientsByCategory(values);
  const indented = new Set([
    "saturates",
    "monounsaturates",
    "polyunsaturates",
    "sugars",
    "polyols",
    "starch",
  ]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {basis === "per_100ml" ? t("per100ml") : t("per100g")}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[18rem] border-collapse text-sm">
          <tbody>
            {groups.map((group) =>
              group.values.map((value) => (
                <tr
                  key={value.code}
                  className="border-b border-black/5 last:border-0 dark:border-white/5"
                >
                  <th
                    scope="row"
                    className={`py-1 pr-4 text-left font-normal text-zinc-600 dark:text-zinc-400 ${
                      indented.has(value.code) ? "pl-4" : ""
                    }`}
                  >
                    {tNutrients(value.code)}
                  </th>
                  <td className="py-1 text-right tabular-nums text-black dark:text-zinc-50">
                    {formatNutrientAmount(value.amount, value.measureUnit)}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
