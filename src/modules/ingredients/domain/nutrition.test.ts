import { describe, it, expect } from "vitest";
import {
  groupNutrientsByCategory,
  formatNutrientAmount,
  groupMonthsIntoRuns,
  type NutrientValue,
} from "./nutrition";

function value(
  code: string,
  category: NutrientValue["category"],
  sortOrder: number,
): NutrientValue {
  return { code, category, sortOrder, measureUnit: "g", euMandatory: false, amount: 1 };
}

describe("groupNutrientsByCategory", () => {
  it("returns categories in declaration order, not input order", () => {
    const groups = groupNutrientsByCategory([
      value("iron", "mineral", 45),
      value("vitamin_c", "vitamin", 24),
      value("fat", "macronutrient", 3),
    ]);
    expect(groups.map((g) => g.category)).toEqual([
      "macronutrient",
      "vitamin",
      "mineral",
    ]);
  });

  it("orders values by sort_order, not alphabetically", () => {
    // "of which saturates" must follow "fat" - alphabetical would invert it.
    const groups = groupNutrientsByCategory([
      value("saturates", "macronutrient", 4),
      value("fat", "macronutrient", 3),
    ]);
    expect(groups[0].values.map((v) => v.code)).toEqual(["fat", "saturates"]);
  });

  it("drops empty categories rather than rendering empty sections", () => {
    const groups = groupNutrientsByCategory([value("fat", "macronutrient", 3)]);
    expect(groups).toHaveLength(1);
  });

  it("returns nothing for an ingredient with no nutrition data", () => {
    expect(groupNutrientsByCategory([])).toEqual([]);
  });
});

describe("formatNutrientAmount", () => {
  it("trims trailing zeros", () => {
    expect(formatNutrientAmount(3.2, "g", "en")).toBe("3.2 g");
    expect(formatNutrientAmount(0, "g", "en")).toBe("0 g");
    expect(formatNutrientAmount(100, "g", "en")).toBe("100 g");
  });

  it("keeps precision on micronutrient-sized amounts", () => {
    expect(formatNutrientAmount(0.03, "mg", "en")).toBe("0.03 mg");
    expect(formatNutrientAmount(0.001, "mg", "en")).toBe("0.001 mg");
  });

  // The reason this function takes a locale at all. A Spanish nutrition
  // label writes 3,2 g; rendering 3.2 g makes a translated page look like
  // an untranslated one.
  it("uses the decimal separator the language actually uses", () => {
    expect(formatNutrientAmount(3.2, "g", "es")).toBe("3,2 g");
    expect(formatNutrientAmount(3.2, "g", "ca")).toBe("3,2 g");
    expect(formatNutrientAmount(3.2, "g", "en")).toBe("3.2 g");
  });

  it("keeps small amounts intact in every locale", () => {
    expect(formatNutrientAmount(0.001, "mg", "es")).toBe("0,001 mg");
    expect(formatNutrientAmount(0.03, "mg", "ca")).toBe("0,03 mg");
  });

  // Energy in kJ is four digits for most fats and oils, so grouping is
  // reachable in real data rather than hypothetical.
  it("groups thousands the way the locale does", () => {
    expect(formatNutrientAmount(3389, "kJ", "en")).toBe("3,389 kJ");
    expect(formatNutrientAmount(3389, "kJ", "es")).toBe("3389 kJ");
  });

  it("still trims to one decimal above 1 regardless of locale", () => {
    expect(formatNutrientAmount(91.64, "g", "es")).toBe("91,6 g");
    expect(formatNutrientAmount(91.64, "g", "en")).toBe("91.6 g");
  });
});

describe("groupMonthsIntoRuns", () => {
  it("returns a single run for consecutive months", () => {
    expect(groupMonthsIntoRuns([6, 7, 8, 9])).toEqual([[6, 9]]);
  });

  // The case that justified storing months as rows instead of a range.
  it("keeps a wraparound season as one run", () => {
    expect(groupMonthsIntoRuns([11, 12, 1, 2, 3])).toEqual([[11, 3]]);
  });

  it("handles an unsorted input", () => {
    expect(groupMonthsIntoRuns([3, 11, 1, 12, 2])).toEqual([[11, 3]]);
  });

  it("splits a genuinely split season into two runs", () => {
    const runs = groupMonthsIntoRuns([3, 4, 9, 10]);
    expect(runs).toHaveLength(2);
    expect(runs).toEqual(expect.arrayContaining([[3, 4], [9, 10]]));
  });

  it("handles a single month", () => {
    expect(groupMonthsIntoRuns([7])).toEqual([[7, 7]]);
  });

  it("collapses a full year to one run", () => {
    expect(groupMonthsIntoRuns([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toEqual([[1, 12]]);
  });

  it("returns nothing for no months", () => {
    expect(groupMonthsIntoRuns([])).toEqual([]);
  });
});
