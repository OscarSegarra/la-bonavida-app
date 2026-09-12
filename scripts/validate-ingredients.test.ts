import { describe, it, expect } from "vitest";
import { validateIngredient, validateDataset, EU_MANDATORY_NUTRIENTS } from "./validate-ingredients.ts";
import { ingredients } from "../data/ingredients.ts";
import type { SeedIngredient } from "../data/ingredient-types.ts";

/** A valid ingredient, to be broken one field at a time. */
function sound(overrides: Partial<SeedIngredient> = {}): SeedIngredient {
  return {
    code: "zz_test",
    food_group: "frutas",
    nutrition_basis: "per_100g",
    names: { es: "ZZ Prueba", ca: "ZZ Prova", en: "ZZ Test" },
    nutrients: {
      energy_kj: 200,
      energy_kcal: 48,
      fat: 0.2,
      saturates: 0,
      carbohydrate: 11,
      sugars: 9,
      protein: 0.5,
      salt: 0,
    },
    dietary_tags: ["vegetarian", "vegan"],
    units: { allowed: ["g", "kg"], default: "g" },
    ...overrides,
  } as SeedIngredient;
}

describe("the dataset that actually ships", () => {
  it("is valid", () => {
    expect(validateDataset(ingredients)).toEqual([]);
  });

  // The review found all 62 complete, but by curation rather than by any
  // rule. This is what turns that into a guarantee.
  it("has every EU-mandatory nutrient on every entry", () => {
    const incomplete = ingredients.filter((item) =>
      EU_MANDATORY_NUTRIENTS.some((code) => item.nutrients[code] === undefined),
    );
    expect(incomplete.map((i) => i.code)).toEqual([]);
  });
});

describe("validateIngredient: the fixture is genuinely sound", () => {
  it("reports no problems", () => {
    expect(validateIngredient(sound())).toEqual([]);
  });
});

describe("validateIngredient: EU-mandatory nutrients", () => {
  it.each(EU_MANDATORY_NUTRIENTS)("rejects an entry missing %s", (code) => {
    const nutrients = { ...sound().nutrients };
    delete nutrients[code];

    const problems = validateIngredient(sound({ nutrients }));
    expect(problems.join(" ")).toContain(code);
    expect(problems.join(" ")).toContain("EU-mandatory");
  });

  it("names every missing nutrient at once, not just the first", () => {
    const problems = validateIngredient(sound({ nutrients: { energy_kcal: 10 } }));
    const text = problems.join(" ");
    for (const code of EU_MANDATORY_NUTRIENTS.filter((c) => c !== "energy_kcal")) {
      expect(text).toContain(code);
    }
  });

  // Zero is a real declared value - water is 0 g of fat, not unknown fat -
  // so it must not be mistaken for absence.
  it("accepts zero as a present value", () => {
    const nutrients = { ...sound().nutrients, fat: 0, saturates: 0, sugars: 0, salt: 0 };
    expect(validateIngredient(sound({ nutrients }))).toEqual([]);
  });

  it("still rejects a negative amount", () => {
    const nutrients = { ...sound().nutrients, fat: -1 };
    expect(validateIngredient(sound({ nutrients })).join(" ")).toContain("negative");
  });
});

describe("validateIngredient: bridging values across dimensions", () => {
  it("requires a density when mass meets volume", () => {
    const problems = validateIngredient(
      sound({ units: { allowed: ["g", "ml"], default: "g" } }),
    );
    expect(problems.join(" ")).toContain("density_g_per_ml");
  });

  // The case the old mass-AND-volume rule missed entirely: count -> volume
  // converts through grams, so it needs a density as well as a unit weight.
  it("requires a density when count meets volume, with no mass unit present", () => {
    const problems = validateIngredient(
      sound({
        units: { allowed: ["unit", "ml"], default: "unit" },
        grams_per_unit: 50,
      }),
    );
    expect(problems.join(" ")).toContain("density_g_per_ml");
  });

  it("accepts count and volume once the density is supplied", () => {
    const problems = validateIngredient(
      sound({
        units: { allowed: ["unit", "ml"], default: "unit" },
        grams_per_unit: 50,
        density_g_per_ml: 1.02,
      }),
    );
    expect(problems).toEqual([]);
  });

  it("does not demand a density when every unit is the same dimension", () => {
    expect(validateIngredient(sound({ units: { allowed: ["g", "kg"], default: "g" } }))).toEqual(
      [],
    );
  });

  it("requires a unit weight whenever a count unit is allowed", () => {
    const problems = validateIngredient(
      sound({ units: { allowed: ["g", "unit"], default: "g" } }),
    );
    expect(problems.join(" ")).toContain("grams_per_unit");
  });
});

describe("validateIngredient: the rules that were already there", () => {
  // The cast is the point, not a workaround: `SeedIngredient` already
  // makes `names.es` required, so the dataset cannot reach this state and
  // the compiler says so. The runtime check still matters because the
  // validator is also the thing that would catch hand-edited or generated
  // input, where no compiler ran.
  it("requires a default-locale name", () => {
    const problems = validateIngredient(
      sound({ names: { en: "Only English" } as SeedIngredient["names"] }),
    );
    expect(problems.join(" ")).toContain("Spanish name");
  });

  it("requires the default unit to be an allowed one", () => {
    const problems = validateIngredient(
      sound({ units: { allowed: ["g"], default: "kg" } }),
    );
    expect(problems.join(" ")).toContain("not in the allowed list");
  });

  it("derives nutrition_basis from the default unit's dimension", () => {
    const problems = validateIngredient(
      sound({
        units: { allowed: ["ml", "l"], default: "ml" },
        nutrition_basis: "per_100g",
      }),
    );
    expect(problems.join(" ")).toContain("per_100ml");
  });

  it("rejects an out-of-range seasonal month", () => {
    const problems = validateIngredient(sound({ seasonality: { es: [0, 13] } }));
    expect(problems.join(" ")).toContain("invalid month");
  });
});

describe("validateDataset: rules between entries", () => {
  it("catches a duplicate code", () => {
    const problems = validateDataset([sound(), sound()]);
    expect(problems.join(" ")).toContain("duplicate code");
  });

  it("catches two ingredients sharing a name in one language", () => {
    const problems = validateDataset([
      sound({ code: "zz_a" }),
      sound({ code: "zz_b", names: { es: "ZZ Prueba", en: "Different" } }),
    ]);
    expect(problems.join(" ")).toContain("already used by");
  });

  it("prefixes every problem with the offending code", () => {
    const problems = validateDataset([sound({ code: "zz_broken", nutrients: {} })]);
    expect(problems.every((p) => p.startsWith("zz_broken: "))).toBe(true);
  });
});
