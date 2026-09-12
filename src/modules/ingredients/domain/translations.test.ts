import { describe, it, expect } from "vitest";
import { resolveTranslation } from "./translations";

const all = [
  { locale: "es", name: "Leche entera" },
  { locale: "ca", name: "Llet sencera" },
  { locale: "en", name: "Whole milk" },
];

describe("resolveTranslation", () => {
  it("uses the requested locale when it exists", () => {
    expect(resolveTranslation(all, "ca", "es")).toEqual({
      name: "Llet sencera",
      isFallback: false,
    });
  });

  it("falls back to the default locale and says so", () => {
    const partial = [{ locale: "es", name: "Leche entera" }];
    expect(resolveTranslation(partial, "en", "es")).toEqual({
      name: "Leche entera",
      isFallback: true,
    });
  });

  it("does not report a fallback when the requested locale IS the default", () => {
    expect(resolveTranslation(all, "es", "es").isFallback).toBe(false);
  });

  // The flag is the whole reason this returns an object rather than a
  // string: without it the UI cannot distinguish "translated" from
  // "showing you Spanish because that is all there is".
  it("distinguishes a real translation from a fallback of the same text", () => {
    const sameText = [
      { locale: "es", name: "Chocolate" },
      { locale: "en", name: "Chocolate" },
    ];
    expect(resolveTranslation(sameText, "en", "es").isFallback).toBe(false);
    expect(resolveTranslation([sameText[0]], "en", "es").isFallback).toBe(true);
  });

  it("degrades to any available name rather than throwing", () => {
    const onlyCatalan = [{ locale: "ca", name: "Llet" }];
    expect(resolveTranslation(onlyCatalan, "en", "es")).toEqual({
      name: "Llet",
      isFallback: true,
    });
  });

  it("degrades to a placeholder when there are no translations at all", () => {
    expect(resolveTranslation([], "en", "es")).toEqual({
      name: "—",
      isFallback: true,
    });
  });
});
