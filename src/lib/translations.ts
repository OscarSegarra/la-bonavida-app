export type Translation = { locale: string; value: string };

export type ResolvedTranslation = {
  value: string;
  /** True when `value` came from the default locale rather than the requested one. */
  isFallback: boolean;
};

/**
 * Picks the text to display for a requested locale, falling back to the
 * default one.
 *
 * The field is called `value` rather than `name` because this resolves an
 * ingredient name, a recipe title and a step body alike - calling a step's
 * text its "name" was the sort of small wrongness that makes a shared
 * helper read as though it belongs to whoever wrote it first.
 *
 * Lives in `lib/` rather than inside a module because it is the fallback
 * *rule*, not a database concern and not any one module's property: every
 * translation companion table in the app resolves this way, and the
 * recipes module needs it exactly as the ingredients module does. Same
 * reasoning that moved text folding and nutrient presentation out during
 * slice 1 - and the same precedent as listUnits() being removed from the
 * ingredients connector in the Phase 2 review.
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
): ResolvedTranslation {
  const exact = translations.find((t) => t.locale === locale);
  if (exact) return { value: exact.value, isFallback: false };

  const fallback = translations.find((t) => t.locale === defaultLocale);
  if (fallback) return { value: fallback.value, isFallback: true };

  // Should be unreachable: the seed importer requires a default-locale
  // name. Degrade to *something* rather than throwing, because this is a
  // read path - a catalog that renders one em dash is recoverable, a
  // catalog that 500s is not.
  return { value: translations[0]?.value ?? "—", isFallback: true };
}
