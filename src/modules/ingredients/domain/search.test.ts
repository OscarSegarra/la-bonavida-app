import { describe, it, expect } from "vitest";
import { foldForSearch, matchesSearch } from "./search";

describe("foldForSearch", () => {
  it("strips the accents that Spanish names actually use", () => {
    expect(foldForSearch("Plátano")).toBe("platano");
    expect(foldForSearch("Brócoli")).toBe("brocoli");
    expect(foldForSearch("Limón")).toBe("limon");
    expect(foldForSearch("Azúcar")).toBe("azucar");
    expect(foldForSearch("Jamón serrano")).toBe("jamon serrano");
  });

  it("strips the accents Catalan adds on top", () => {
    expect(foldForSearch("Lluç")).toBe("lluc");
    expect(foldForSearch("Pernil serrà")).toBe("pernil serra");
    expect(foldForSearch("Arròs")).toBe("arros");
    expect(foldForSearch("Raïm")).toBe("raim");
  });

  it("leaves unaccented text alone apart from case", () => {
    expect(foldForSearch("Tomate")).toBe("tomate");
    expect(foldForSearch("CEBOLLA")).toBe("cebolla");
  });

  // The ñ is a letter in its own right, not an accented n - a Spanish
  // speaker searching "nino" does not expect "niño". NFD does decompose
  // it, so this records the consequence we accept rather than a property
  // we designed for.
  it("also folds ñ, which decomposition cannot distinguish", () => {
    expect(foldForSearch("Piña")).toBe("pina");
  });
});

describe("matchesSearch", () => {
  const names = ["Plátano", "Plàtan", "Banana"];

  it("finds an accented name from unaccented input - the whole point", () => {
    expect(matchesSearch("platano", "platano", names)).toBe(true);
  });

  it("finds it from the accented spelling too", () => {
    expect(matchesSearch("plátano", "platano", names)).toBe(true);
  });

  it("matches a name in a language other than the one being displayed", () => {
    expect(matchesSearch("banana", "platano", names)).toBe(true);
  });

  it("matches on the code, which is already unaccented", () => {
    expect(matchesSearch("melocoton", "melocoton", ["Melocotón"])).toBe(true);
  });

  it("matches on a substring, not just a prefix", () => {
    expect(matchesSearch("tano", "platano", names)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesSearch("PLATANO", "platano", names)).toBe(true);
  });

  it("does not match something unrelated", () => {
    expect(matchesSearch("merluza", "platano", names)).toBe(false);
  });

  // An empty or whitespace-only term means "no filter", not "match
  // nothing" - otherwise clearing the search box empties the catalog.
  it("treats an empty or blank term as no filter at all", () => {
    expect(matchesSearch("", "platano", names)).toBe(true);
    expect(matchesSearch("   ", "platano", names)).toBe(true);
  });

  it("ignores surrounding whitespace in the term", () => {
    expect(matchesSearch("  platano  ", "platano", names)).toBe(true);
  });

  it("survives an ingredient with no translations at all", () => {
    expect(matchesSearch("platano", "platano", [])).toBe(true);
    expect(matchesSearch("merluza", "platano", [])).toBe(false);
  });
});
