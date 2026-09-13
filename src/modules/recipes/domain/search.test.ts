import { describe, it, expect } from "vitest";
import { matchesRecipeSearch, type SearchableRecipe } from "./search";

function recipe(overrides: Partial<SearchableRecipe> = {}): SearchableRecipe {
  return {
    code: "tortilla_patatas",
    titles: ["Tortilla de patatas", "Truita de patates", "Potato omelette"],
    ingredientCodes: ["patata", "huevo", "cebolla"],
    ingredientNames: ["Patata", "Huevo", "Cebolla", "Ou", "Egg", "Onion"],
    ...overrides,
  };
}

describe("matchesRecipeSearch: by name", () => {
  it("matches a title in the language being read", () => {
    expect(matchesRecipeSearch("tortilla", recipe())).toBe(true);
  });

  it("matches a title in another language the recipe has", () => {
    expect(matchesRecipeSearch("omelette", recipe())).toBe(true);
  });

  it("matches the code", () => {
    expect(matchesRecipeSearch("patatas", recipe())).toBe(true);
  });

  it("returns everything for an empty term", () => {
    expect(matchesRecipeSearch("   ", recipe())).toBe(true);
  });

  it("does not match something unrelated", () => {
    expect(matchesRecipeSearch("merluza", recipe())).toBe(false);
  });
});

describe("matchesRecipeSearch: by ingredient", () => {
  // "What can I make with chicken" is the second thing anyone tries.
  it("finds a recipe by something it is made of", () => {
    expect(matchesRecipeSearch("cebolla", recipe())).toBe(true);
  });

  it("finds it by an ingredient name in another language", () => {
    expect(matchesRecipeSearch("onion", recipe())).toBe(true);
  });

  it("finds it by an ingredient code", () => {
    expect(matchesRecipeSearch("huevo", recipe())).toBe(true);
  });

  it("does not find it by an ingredient it does not use", () => {
    expect(matchesRecipeSearch("salmon", recipe())).toBe(false);
  });
});

describe("matchesRecipeSearch: accents", () => {
  // The shared folding helper, behaving here exactly as it does in the
  // ingredient catalog.
  it("finds an accented title without the accent", () => {
    const r = recipe({ titles: ["Pollo al horno con limón"], ingredientNames: [] });
    expect(matchesRecipeSearch("limon", r)).toBe(true);
  });

  it("finds an accented ingredient name without the accent", () => {
    const r = recipe({ titles: ["Zumo"], ingredientNames: ["Plátano"] });
    expect(matchesRecipeSearch("platano", r)).toBe(true);
  });
});
