import { describe, it, expect } from "vitest";
import { offeredSizes, scaleQuantity, type ScalableRecipe } from "./scaling";

function mass(quantity: number) {
  return { quantity, dimension: "mass" as const, countDivisible: null };
}
function countOf(quantity: number, divisible: boolean) {
  return { quantity, dimension: "count" as const, countDivisible: divisible };
}

function recipe(overrides: Partial<ScalableRecipe> = {}): ScalableRecipe {
  return { servings: 4, minServings: 1, lines: [mass(300)], ...overrides };
}

describe("offeredSizes", () => {
  it("always offers the recipe's own size", () => {
    expect(offeredSizes(recipe())).toContain(4);
  });

  it("offers halves and multiples when only mass is involved", () => {
    expect(offeredSizes(recipe())).toEqual([2, 4, 6, 8, 12]);
  });

  // The worked example from the plan: 4 eggs halve to 2, so the small size
  // survives.
  it("halves a count line that divides evenly", () => {
    const sizes = offeredSizes(recipe({ lines: [countOf(4, false), mass(300)] }));
    expect(sizes).toContain(2);
  });

  // And the case the whole design exists for: one egg for four people
  // cannot be made for two, so that size is simply not offered rather than
  // being offered with half an egg in it.
  it("refuses to halve a single indivisible item", () => {
    const sizes = offeredSizes(recipe({ lines: [countOf(1, false), mass(300)] }));
    expect(sizes).not.toContain(2);
    expect(sizes).toContain(4);
  });

  // Note 6 is missing, and that is right: x1.5 of a single egg is 1.5 of
  // it, so scaling UP breaks on an indivisible item exactly as readily as
  // scaling down. Only whole multiples survive.
  it("still offers larger sizes when the small one is impossible", () => {
    const sizes = offeredSizes(recipe({ lines: [countOf(1, false)] }));
    expect(sizes).toEqual([4, 8, 12]);
  });

  // Half an onion is a real thing, so a divisible count line never removes
  // a size.
  it("lets a divisible count line come out fractional", () => {
    const sizes = offeredSizes(recipe({ lines: [countOf(1, true), mass(300)] }));
    expect(sizes).toContain(2);
  });

  it("never offers a size below min_servings", () => {
    expect(offeredSizes(recipe({ minServings: 4 }))).toEqual([4, 6, 8, 12]);
  });

  // A recipe serves people, and there is no such thing as 4.5 of them.
  it("skips a factor that would not land on a whole number of servings", () => {
    expect(offeredSizes(recipe({ servings: 3 }))).toEqual([3, 6, 9]);
  });

  it("returns the sizes ascending and without duplicates", () => {
    const sizes = offeredSizes(recipe({ servings: 2 }));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  // The guarantee the whole design exists to provide, asserted as a
  // property rather than as one example.
  it("never offers a size that would need a fraction of something indivisible", () => {
    const r = recipe({ servings: 4, lines: [countOf(5, false), countOf(2, true), mass(600)] });
    for (const target of offeredSizes(r)) {
      for (const line of r.lines) {
        const scaled = scaleQuantity(line.quantity, r.servings, target);
        if (line.dimension === "count" && line.countDivisible === false) {
          expect(Number.isInteger(scaled)).toBe(true);
        }
      }
    }
  });
});

describe("scaleQuantity", () => {
  it("returns the quantity unchanged at the recipe's own size", () => {
    expect(scaleQuantity(300, 4, 4)).toBe(300);
  });

  it("halves and doubles", () => {
    expect(scaleQuantity(300, 4, 2)).toBe(150);
    expect(scaleQuantity(300, 4, 8)).toBe(600);
  });

  it("does not round - the sizes are filtered so it never needs to", () => {
    expect(scaleQuantity(1, 4, 2)).toBe(0.5);
  });
});
