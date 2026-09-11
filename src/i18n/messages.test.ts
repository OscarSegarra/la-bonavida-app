import { describe, it, expect } from "vitest";
import { routing } from "./routing";
import es from "../../messages/es.json";
import ca from "../../messages/ca.json";
import en from "../../messages/en.json";

const catalogs: Record<string, unknown> = { es, ca, en };

/** Flattens a nested catalog into dotted key paths, ignoring the values. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("message catalogs", () => {
  it("has a catalog for every configured locale", () => {
    for (const locale of routing.locales) {
      expect(catalogs[locale], `missing messages/${locale}.json`).toBeDefined();
    }
  });

  // The failure this guards against is the ordinary one: someone adds a
  // string to the default locale while building a feature and forgets the
  // other two. Nothing else catches it - a missing key only surfaces at
  // runtime, in a language the person who added it probably does not read.
  it("defines exactly the same keys in every language", () => {
    const expected = keyPaths(catalogs[routing.defaultLocale]).sort();

    for (const locale of routing.locales) {
      if (locale === routing.defaultLocale) continue;
      const actual = keyPaths(catalogs[locale]).sort();

      const missing = expected.filter((k) => !actual.includes(k));
      const extra = actual.filter((k) => !expected.includes(k));

      expect(missing, `${locale}.json is missing keys`).toEqual([]);
      expect(extra, `${locale}.json has keys no other language has`).toEqual([]);
    }
  });

  it("has no blank strings", () => {
    for (const locale of routing.locales) {
      const blanks = Object.entries(
        flatten(catalogs[locale] as Record<string, unknown>),
      )
        .filter(([, v]) => typeof v === "string" && v.trim() === "")
        .map(([k]) => k);
      expect(blanks, `${locale}.json has empty translations`).toEqual([]);
    }
  });
});

/** Flattens to a dotted-key map, keeping the values. */
function flatten(
  value: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  return Object.entries(value).reduce<Record<string, unknown>>(
    (acc, [key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof child === "object" && child !== null) {
        Object.assign(acc, flatten(child as Record<string, unknown>, path));
      } else {
        acc[path] = child;
      }
      return acc;
    },
    {},
  );
}
