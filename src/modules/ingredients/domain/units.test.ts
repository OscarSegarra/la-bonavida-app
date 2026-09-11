import { describe, it, expect } from "vitest";
import { convertQuantity, type UnitInfo } from "./units";

const g: UnitInfo = { code: "g", dimension: "mass", toBaseFactor: 1 };
const kg: UnitInfo = { code: "kg", dimension: "mass", toBaseFactor: 1000 };
const ml: UnitInfo = { code: "ml", dimension: "volume", toBaseFactor: 1 };
const l: UnitInfo = { code: "l", dimension: "volume", toBaseFactor: 1000 };
const tbsp: UnitInfo = { code: "tbsp", dimension: "volume", toBaseFactor: 15 };
const unit: UnitInfo = { code: "unit", dimension: "count", toBaseFactor: 1 };

describe("convertQuantity: same dimension", () => {
  it("converts within mass", () => {
    expect(convertQuantity(1500, g, kg)).toBe(1.5);
    expect(convertQuantity(2, kg, g)).toBe(2000);
  });

  it("converts within volume, including spoons", () => {
    expect(convertQuantity(1500, ml, l)).toBe(1.5);
    expect(convertQuantity(2, tbsp, ml)).toBe(30);
  });

  it("is identity for the same unit", () => {
    expect(convertQuantity(7, g, g)).toBe(7);
  });

  it("round-trips", () => {
    const there = convertQuantity(250, g, kg)!;
    expect(convertQuantity(there, kg, g)).toBeCloseTo(250);
  });

  it("handles zero", () => {
    expect(convertQuantity(0, g, kg)).toBe(0);
  });

  it("needs no bridging value", () => {
    expect(convertQuantity(1000, g, kg, {})).toBe(1);
  });
});

describe("convertQuantity: crossing dimensions", () => {
  it("converts volume to mass with a density", () => {
    // 1 tbsp of olive oil: 15 ml * 0.916 g/ml
    expect(convertQuantity(1, tbsp, g, { densityGPerMl: 0.916 })).toBeCloseTo(13.74);
  });

  it("converts mass to volume with a density", () => {
    expect(convertQuantity(13.74, g, tbsp, { densityGPerMl: 0.916 })).toBeCloseTo(1);
  });

  it("converts count to mass with a unit weight", () => {
    expect(convertQuantity(2, unit, g, { gramsPerUnit: 58 })).toBe(116);
  });

  it("converts mass to count with a unit weight", () => {
    expect(convertQuantity(116, g, unit, { gramsPerUnit: 58 })).toBe(2);
  });

  // The important half: refusing, rather than guessing, is what keeps a
  // missing bridging value from silently producing a wrong number.
  it("returns null when a density is needed but absent", () => {
    expect(convertQuantity(1, tbsp, g)).toBeNull();
    expect(convertQuantity(1, tbsp, g, { densityGPerMl: null })).toBeNull();
  });

  it("returns null when a unit weight is needed but absent", () => {
    expect(convertQuantity(2, unit, g)).toBeNull();
    expect(convertQuantity(2, unit, g, { gramsPerUnit: null })).toBeNull();
  });

  it("returns null for count to volume without both bridges", () => {
    expect(convertQuantity(1, unit, ml, { gramsPerUnit: 58 })).toBeNull();
  });

  it("converts count to volume when both bridges are present", () => {
    // 1 egg = 58 g; at 1.03 g/ml that is ~56.3 ml
    expect(
      convertQuantity(1, unit, ml, { gramsPerUnit: 58, densityGPerMl: 1.03 }),
    ).toBeCloseTo(56.31, 1);
  });

  it("rejects a non-finite amount", () => {
    expect(convertQuantity(Number.NaN, g, kg)).toBeNull();
    expect(convertQuantity(Number.POSITIVE_INFINITY, g, kg)).toBeNull();
  });
});
