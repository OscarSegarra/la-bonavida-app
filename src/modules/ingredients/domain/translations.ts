export type Translation = { locale: string; name: string };

export type ResolvedName = {
  name: string;
  /** True when `name` came from the default locale rather than the requested one. */
  isFallback: boolean;
};

/**
 * Picks the name to display for a requested locale, falling back to the
 * default one.
 *
 * Lives in `domain/` rather than inside the query because it is the
 * fallback *rule*, not a database concern - the same rule will apply to
 * any other translated content, and it is worth being able to test it
 * directly rather than only through a live query.
 *
 * Reports whether it fell back, so the UI can mark a name shown in a
 * language the reader did not ask for. Silently substituting Spanish into
 * an English page makes a partly-translated catalog look broken rather
 * than partly translated.
 * @param translations Every translation the item has.
 * @param locale The locale the reader asked for.
 * @param defaultLocale The locale to fall back to.
 * @returns The name to display and whether it is a fallback.
 */
export function resolveTranslation(
  translations: Translation[],
  locale: string,
  defaultLocale: string,
): ResolvedName {
  const exact = translations.find((t) => t.locale === locale);
  if (exact) return { name: exact.name, isFallback: false };

  const fallback = translations.find((t) => t.locale === defaultLocale);
  if (fallback) return { name: fallback.name, isFallback: true };

  // Should be unreachable: the seed importer requires a default-locale
  // name. Degrade to *something* rather than throwing, because this is a
  // read path - a catalog that renders one em dash is recoverable, a
  // catalog that 500s is not.
  return { name: translations[0]?.name ?? "—", isFallback: true };
}
