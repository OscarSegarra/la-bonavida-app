import { describe, it, expect } from "vitest";
import { isBasic } from "./basics";

describe("isBasic", () => {
  it("treats one line with no steps as a basic", () => {
    expect(isBasic({ lineCount: 1, stepCount: 0 })).toBe(true);
  });

  // A real dish always has at least one step, which is what makes the
  // derivation safe without a tag.
  it("does not treat a one-ingredient dish with steps as a basic", () => {
    expect(isBasic({ lineCount: 1, stepCount: 3 })).toBe(false);
  });

  it("does not treat a multi-ingredient recipe as a basic, even with no steps", () => {
    expect(isBasic({ lineCount: 4, stepCount: 0 })).toBe(false);
  });
});
