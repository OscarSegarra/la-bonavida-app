import { describe, it, expect } from "vitest";
import {
  validateRecipe,
  validateRecipeDataset,
  orderByDependency,
} from "./validate-recipes.ts";
import { recipes } from "../data/recipes.ts";
import { ingredients } from "../data/ingredients.ts";
import type { SeedRecipe } from "../data/recipe-types.ts";
import type { SeedIngredient } from "../data/ingredient-types.ts";

const ingredientsByCode = new Map(ingredients.map((i) => [i.code, i]));

/** A valid recipe, to be broken one field at a time. */
function sound(overrides: Partial<SeedRecipe> = {}): SeedRecipe {
  return {
    code: "zz_test",
    servings: 2,
    yield: { quantity: 500, unit: "g" },
    translations: {
      es: { title: "ZZ Prueba" },
      ca: { title: "ZZ Prova" },
      en: { title: "ZZ Test" },
    },
    steps: [{ es: "Uno.", ca: "U.", en: "One." }],
    lines: [{ ingredient: "arroz_blanco", quantity: 100, unit: "g" }],
    ...overrides,
  };
}

describe("the dataset that actually ships", () => {
  it("is valid", () => {
    expect(validateRecipeDataset(recipes, ingredients)).toEqual([]);
  });

  it("is written in all three locales throughout", () => {
    const incomplete = recipes.filter(
      (r) => !r.translations.es?.title || !r.translations.ca?.title || !r.translations.en?.title,
    );
    expect(incomplete.map((r) => r.code)).toEqual([]);
  });

  it("can be ordered so every sub-recipe comes before the recipe using it", () => {
    const ordered = orderByDependency(recipes);
    const seen = new Set<string>();
    for (const recipe of ordered) {
      for (const line of recipe.lines) {
        if (line.recipe) expect(seen).toContain(line.recipe);
      }
      seen.add(recipe.code);
    }
    expect(ordered).toHaveLength(recipes.length);
  });

  // Not a rule, an observation worth pinning: these are the entries the
  // browse list hides by default, and "one line and no steps" is the whole
  // definition.
  it("contains basics, recognisable as one line and no steps", () => {
    const basics = recipes
      .filter((r) => r.lines.length === 1 && (r.steps ?? []).length === 0)
      .map((r) => r.code)
      .sort();
    expect(basics).toEqual(["manzana", "vaso_de_leche"]);
  });
});

describe("validateRecipe: the fixture is genuinely sound", () => {
  it("reports no problems", () => {
    expect(validateRecipe(sound(), ingredientsByCode, new Set(["zz_test"]))).toEqual([]);
  });
});

describe("validateRecipe: locales", () => {
  it("requires a default-locale title", () => {
    const problems = validateRecipe(
      sound({ translations: { en: { title: "Only English" } } as SeedRecipe["translations"] }),
      ingredientsByCode,
      new Set(["zz_test"]),
    );
    expect(problems.join(" ")).toContain("default locale");
  });

  // The mixed-language trap: valid to the database, visibly broken to a
  // person, and impossible to tell apart from a missing translation.
  it("rejects a step that skips a locale the recipe declares", () => {
    const problems = validateRecipe(
      sound({ steps: [{ es: "Uno.", ca: "U." }] }),
      ingredientsByCode,
      new Set(["zz_test"]),
    );
    expect(problems.join(" ")).toContain("every step must exist in every language");
  });

  it("rejects a step in a locale the recipe has no title for", () => {
    const problems = validateRecipe(
      sound({
        translations: { es: { title: "Solo español" } },
        steps: [{ es: "Uno.", en: "One." }],
      }),
      ingredientsByCode,
      new Set(["zz_test"]),
    );
    expect(problems.join(" ")).toContain("every step must exist in every language");
  });

  it("accepts a recipe with no steps at all", () => {
    expect(
      validateRecipe(sound({ steps: undefined }), ingredientsByCode, new Set(["zz_test"])),
    ).toEqual([]);
  });
});

describe("validateRecipe: lines", () => {
  it("rejects a recipe with no lines", () => {
    const problems = validateRecipe(sound({ lines: [] }), ingredientsByCode, new Set());
    expect(problems.join(" ")).toContain("not a recipe");
  });

  it("rejects a line naming both an ingredient and a sub-recipe", () => {
    const problems = validateRecipe(
      sound({ lines: [{ ingredient: "arroz_blanco", recipe: "zz_other", quantity: 1, unit: "g" }] }),
      ingredientsByCode,
      new Set(["zz_other"]),
    );
    expect(problems.join(" ")).toContain("exactly one");
  });

  it("rejects a line naming neither", () => {
    const problems = validateRecipe(
      sound({ lines: [{ quantity: 1, unit: "g" }] }),
      ingredientsByCode,
      new Set(),
    );
    expect(problems.join(" ")).toContain("exactly one");
  });

  it("rejects a quantity of zero - there is no 'to taste'", () => {
    const problems = validateRecipe(
      sound({ lines: [{ ingredient: "arroz_blanco", quantity: 0, unit: "g" }] }),
      ingredientsByCode,
      new Set(),
    );
    expect(problems.join(" ")).toContain("to taste");
  });

  it("rejects an unknown ingredient code", () => {
    const problems = validateRecipe(
      sound({ lines: [{ ingredient: "zz_no_such", quantity: 1, unit: "g" }] }),
      ingredientsByCode,
      new Set(),
    );
    expect(problems.join(" ")).toContain("unknown ingredient");
  });

  it("rejects an unknown sub-recipe code", () => {
    const problems = validateRecipe(
      sound({ lines: [{ recipe: "zz_no_such", quantity: 1, unit: "g" }] }),
      ingredientsByCode,
      new Set(),
    );
    expect(problems.join(" ")).toContain("unknown sub-recipe");
  });

  // The database enforces this at commit; catching it here means the
  // message names the recipe and line rather than arriving as a constraint
  // violation halfway through a seed run.
  it("rejects a unit the ingredient does not allow", () => {
    const problems = validateRecipe(
      sound({ lines: [{ ingredient: "arroz_blanco", quantity: 1, unit: "ml" }] }),
      ingredientsByCode,
      new Set(),
    );
    expect(problems.join(" ")).toContain("allowed units");
  });
});

describe("validateRecipe: servings", () => {
  it("rejects a minimum above the recipe's own servings", () => {
    const problems = validateRecipe(
      sound({ servings: 2, min_servings: 4 }),
      ingredientsByCode,
      new Set(),
    );
    expect(problems.join(" ")).toContain("min_servings");
  });
});

describe("orderByDependency", () => {
  function line(code: string) {
    return { recipe: code, quantity: 1, unit: "g" as const };
  }

  it("puts a sub-recipe before the recipe using it, whatever the file order", () => {
    const parent = sound({ code: "zz_parent", lines: [line("zz_child")] });
    const child = sound({ code: "zz_child" });

    const ordered = orderByDependency([parent, child]).map((r) => r.code);
    expect(ordered.indexOf("zz_child")).toBeLessThan(ordered.indexOf("zz_parent"));
  });

  it("handles a chain several deep", () => {
    const a = sound({ code: "zz_a", lines: [line("zz_b")] });
    const b = sound({ code: "zz_b", lines: [line("zz_c")] });
    const c = sound({ code: "zz_c" });

    expect(orderByDependency([a, b, c]).map((r) => r.code)).toEqual(["zz_c", "zz_b", "zz_a"]);
  });

  it("emits each recipe exactly once when two parents share a child", () => {
    const a = sound({ code: "zz_a", lines: [line("zz_shared")] });
    const b = sound({ code: "zz_b", lines: [line("zz_shared")] });
    const shared = sound({ code: "zz_shared" });

    const ordered = orderByDependency([a, b, shared]).map((r) => r.code);
    expect(ordered).toHaveLength(3);
    expect(new Set(ordered).size).toBe(3);
  });

  it("names the whole path when the dataset contains a cycle", () => {
    const a = sound({ code: "zz_a", lines: [line("zz_b")] });
    const b = sound({ code: "zz_b", lines: [line("zz_a")] });

    expect(() => orderByDependency([a, b])).toThrow(/cycle/);
  });

  it("ignores an unknown sub-recipe rather than competing with the validator", () => {
    const a = sound({ code: "zz_a", lines: [line("zz_missing")] });
    expect(orderByDependency([a]).map((r) => r.code)).toEqual(["zz_a"]);
  });
});

describe("validateRecipeDataset: rules between recipes", () => {
  it("catches a duplicate code", () => {
    const problems = validateRecipeDataset([sound(), sound()], ingredients as SeedIngredient[]);
    expect(problems.join(" ")).toContain("duplicate code");
  });

  it("catches two recipes sharing a title in one language", () => {
    const problems = validateRecipeDataset(
      [
        sound({ code: "zz_a" }),
        sound({
          code: "zz_b",
          translations: { es: { title: "ZZ Prueba" }, ca: { title: "X" }, en: { title: "Y" } },
        }),
      ],
      ingredients as SeedIngredient[],
    );
    expect(problems.join(" ")).toContain("already used by");
  });

  it("reports a cycle as a dataset failure rather than throwing", () => {
    const a = sound({ code: "zz_a", lines: [{ recipe: "zz_b", quantity: 1, unit: "g" }] });
    const b = sound({ code: "zz_b", lines: [{ recipe: "zz_a", quantity: 1, unit: "g" }] });

    const problems = validateRecipeDataset([a, b], ingredients as SeedIngredient[]);
    expect(problems.join(" ")).toContain("cycle");
  });

  it("prefixes every problem with the offending code", () => {
    const problems = validateRecipeDataset(
      [sound({ code: "zz_broken", lines: [] })],
      ingredients as SeedIngredient[],
    );
    expect(problems.some((p) => p.startsWith("zz_broken: "))).toBe(true);
  });
});
