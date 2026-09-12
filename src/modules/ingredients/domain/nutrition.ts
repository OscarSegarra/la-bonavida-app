export type NutrientCategory = "macronutrient" | "vitamin" | "mineral";

export type NutrientValue = {
  code: string;
  measureUnit: string;
  category: NutrientCategory;
  euMandatory: boolean;
  sortOrder: number;
  amount: number;
};

export type NutrientGroup = {
  category: NutrientCategory;
  values: NutrientValue[];
};

/** The order EU Regulation 1169/2011 prescribes for a nutrition declaration. */
const CATEGORY_ORDER: NutrientCategory[] = ["macronutrient", "vitamin", "mineral"];

/**
 * Groups an ingredient's nutrient values for display as a label.
 *
 * Categories come out in the order the regulation prescribes, and values
 * within each follow the `sort_order` seeded with the nutrient vocabulary
 * rather than alphabetically - "of which saturates" has to sit under
 * "fat", which neither the code nor the translated name would give you.
 *
 * Empty categories are dropped, because nutrition data is sparse by
 * design: an ingredient with no known vitamins should render no vitamin
 * section, not an empty one.
 * @param values The ingredient's known nutrient values.
 * @returns Non-empty groups, in declaration order.
 */
export function groupNutrientsByCategory(values: NutrientValue[]): NutrientGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    values: values
      .filter((value) => value.category === category)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  })).filter((group) => group.values.length > 0);
}

/**
 * Formats a nutrient amount for display in a given language.
 *
 * Trailing zeros are trimmed so a label reads "3,2 g" and "0 g" rather
 * than "3,20 g" and "0,00 g", and very small amounts keep enough precision
 * to stay meaningful - micronutrients are often below 0.1 of their unit.
 *
 * The locale is not optional, because the decimal separator is not a
 * cosmetic choice: Spanish and Catalan write 3,2 where English writes 3.2,
 * and a nutrition label showing the wrong one reads as a foreign document.
 * Everything else in this app is translated; a bare `toFixed` quietly was
 * not. `Intl.NumberFormat` also groups thousands the local way, which
 * matters here because energy in kJ runs to four digits.
 * @param amount The value to format.
 * @param measureUnit The unit it is expressed in.
 * @param locale The BCP 47 locale to format the number for.
 * @returns A display string such as `"3,2 g"` in Spanish or `"3.2 g"` in English.
 */
export function formatNutrientAmount(
  amount: number,
  measureUnit: string,
  locale: string,
): string {
  // Round first, format second. Doing it the other way round would leave
  // maximumFractionDigits to decide precision, which cannot express "two
  // significant figures below 1" - and that is the rule micronutrients
  // need, where 0.0005 mg must not collapse to 0.
  const rounded =
    Math.abs(amount) < 1 ? Number(amount.toPrecision(2)) : Number(amount.toFixed(1));

  // maximumFractionDigits has to be raised from its default of 3, or the
  // very small values the rounding above went to the trouble of keeping
  // would be thrown away again here.
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 20,
  }).format(rounded);

  return `${formatted} ${measureUnit}`;
}

/**
 * Turns a set of in-season months into contiguous runs, so a season reads
 * as "November – March" rather than twelve separate month names.
 *
 * Runs wrap around the end of the year, which is the case that made
 * month-per-row worth it: Spanish citrus is {11,12,1,2,3}, and a naive
 * sort would render it as two disjoint ranges.
 * @param months In-season month numbers, 1-12, in any order.
 * @returns Runs of `[startMonth, endMonth]`, wrapping where they wrap.
 */
export function groupMonthsIntoRuns(months: number[]): Array<[number, number]> {
  const present = new Set(months);
  if (present.size === 0) return [];
  if (present.size === 12) return [[1, 12]];

  // Start from a month whose predecessor is absent, so the first run is a
  // real beginning rather than the middle of a wrapping one.
  const start = [...present].find((m) => !present.has(m === 1 ? 12 : m - 1));
  if (start === undefined) return [[1, 12]];

  const runs: Array<[number, number]> = [];
  let cursor = start;
  let seen = 0;

  while (seen < present.size) {
    const runStart = cursor;
    let runEnd = cursor;
    while (present.has(runEnd === 12 ? 1 : runEnd + 1) && seen + 1 < present.size) {
      runEnd = runEnd === 12 ? 1 : runEnd + 1;
      seen += 1;
    }
    seen += 1;
    runs.push([runStart, runEnd]);

    // Advance to the next present month that starts a new run.
    let next = runEnd === 12 ? 1 : runEnd + 1;
    while (!present.has(next) && seen < present.size) {
      next = next === 12 ? 1 : next + 1;
    }
    cursor = next;
  }

  return runs;
}
