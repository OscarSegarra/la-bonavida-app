import { useLocale, useTranslations } from "next-intl";
import {
  groupNutrientsByCategory,
  formatNutrientAmount,
  type NutrientValue,
} from "./nutrients";

/**
 * Renders a nutrition declaration, for whatever the values belong to.
 *
 * Sub-declarations ("of which saturates") are indented rather than given
 * their own row heading, matching how a real label reads. Which rows exist
 * at all is driven entirely by the data: nutrition is sparse by design, so
 * something with only the mandatory seven shows seven rows and no empty
 * vitamin section.
 *
 * The empty-state message is a prop rather than a translation key looked
 * up in here, because the wording is not the same for every caller - an
 * ingredient has no nutrition data, a recipe has no nutrition data *yet* -
 * and a shared component should not have to know which one it is
 * rendering.
 * @param values The known nutrient values.
 * @param basis Whether the amounts are per 100 g or per 100 ml.
 * @param emptyMessage Already-translated text to show when there are none.
 * @returns A table, or the caller's note when nothing is known.
 */
export function NutritionTable({
  values,
  basis,
  emptyMessage,
}: {
  values: NutrientValue[];
  basis: "per_100g" | "per_100ml";
  emptyMessage: string;
}) {
  // Two namespaces: "nutrition" is this table's own chrome, "nutrients" is
  // the shared vocabulary keyed by nutrient code.
  const t = useTranslations("nutrition");
  const tNutrients = useTranslations("nutrients");
  // Amounts are numbers, and numbers are written differently per language:
  // 3,2 g in Spanish and Catalan, 3.2 g in English.
  const locale = useLocale();

  if (values.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyMessage}</p>
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
                    {formatNutrientAmount(value.amount, value.measureUnit, locale)}
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
