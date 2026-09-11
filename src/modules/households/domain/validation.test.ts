import { describe, expect, it } from "vitest";
import { validateAlias, validateHouseholdName, isMemberRole } from "./validation";

describe("validateAlias", () => {
  it("accepts a normal alias", () => {
    expect(validateAlias("Oscar")).toBeNull();
  });

  it("rejects empty or whitespace-only", () => {
    expect(validateAlias("")).not.toBeNull();
    expect(validateAlias("   ")).not.toBeNull();
  });

  it("rejects over 60 characters", () => {
    expect(validateAlias("a".repeat(61))).not.toBeNull();
    expect(validateAlias("a".repeat(60))).toBeNull();
  });
});

describe("validateHouseholdName", () => {
  it("accepts a normal name", () => {
    expect(validateHouseholdName("The Segarra House")).toBeNull();
  });

  it("rejects empty or whitespace-only", () => {
    expect(validateHouseholdName("")).not.toBeNull();
    expect(validateHouseholdName("   ")).not.toBeNull();
  });

  it("rejects over 100 characters", () => {
    expect(validateHouseholdName("a".repeat(101))).not.toBeNull();
    expect(validateHouseholdName("a".repeat(100))).toBeNull();
  });
});

describe("isMemberRole", () => {
  it("accepts owner and member", () => {
    expect(isMemberRole("owner")).toBe(true);
    expect(isMemberRole("member")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isMemberRole("admin")).toBe(false);
    expect(isMemberRole("")).toBe(false);
  });
});
