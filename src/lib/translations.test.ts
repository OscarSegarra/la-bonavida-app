import { describe, it, expect } from "vitest";
import { resolveTranslation } from "./translations";

const all = [
  { locale: "es", value: "Leche entera" },
  { locale: "ca", value: "Llet sencera" },
  { locale: "en", value: "Whole milk" },
];

describe("resolveTranslation", () => {
  it("uses the requested locale when it exists", () => {
    expect(resolveTranslation(all, "ca", "es")).toEqual({
      value: "Llet sencera",
      isFallback: false,
    });
  });

  it("falls back to the default locale and says so", () => {
    const partial = [{ locale: "es", value: "Leche entera" }];
    expect(resolveTranslation(partial, "en", "es")).toEqual({
      value: "Leche entera",
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
      { locale: "es", value: "Chocolate" },
      { locale: "en", value: "Chocolate" },
    ];
    expect(resolveTranslation(sameText, "en", "es").isFallback).toBe(false);
    expect(resolveTranslation([sameText[0]], "en", "es").isFallback).toBe(true);
  });

  it("degrades to any available name rather than throwing", () => {
    const onlyCatalan = [{ locale: "ca", value: "Llet" }];
    expect(resolveTranslation(onlyCatalan, "en", "es")).toEqual({
      value: "Llet",
      isFallback: true,
    });
  });

  it("degrades to a placeholder when there are no translations at all", () => {
    expect(resolveTranslation([], "en", "es")).toEqual({
      value: "—",
      isFallback: true,
    });
  });
});
