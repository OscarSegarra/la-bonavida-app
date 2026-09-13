import { describe, it, expect } from "vitest";
import { groupMonthsIntoRuns } from "./seasonality";

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
