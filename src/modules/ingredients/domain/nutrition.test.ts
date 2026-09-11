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
    expect(formatNutrientAmount(3.2, "g")).toBe("3.2 g");
    expect(formatNutrientAmount(0, "g")).toBe("0 g");
    expect(formatNutrientAmount(100, "g")).toBe("100 g");
  });

  it("keeps precision on micronutrient-sized amounts", () => {
    expect(formatNutrientAmount(0.03, "mg")).toBe("0.03 mg");
    expect(formatNutrientAmount(0.001, "mg")).toBe("0.001 mg");
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
