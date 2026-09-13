/**
 * Normalises text for searching: lowercased and stripped of accents.
 *
 * Spanish and Catalan names are full of accents and nobody
 * types them on a phone - "platano" has to find "Plátano", "brocoli" has
 * to find "Brócoli". Case folding alone does not do that.
 *
 * How it works: NFD splits an accented letter into its base letter plus a
 * separate combining mark, and U+0300-U+036F is the block those marks live
 * in, so removing that range leaves the plain letter behind.
 *
 * This is deliberately NOT typo tolerance, which is still deferred. It
 * makes correctly-spelled-but-unaccented input work, which is the ordinary
 * case rather than the clever one, and it needs no extension and no index.
 * @param value The text to normalise.
 * @returns The lowercase, unaccented form.
 */
export function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Decides whether a named, coded thing matches a search term.
 *
 * Used by the ingredient catalog and the recipe catalog alike - both are
 * a stable slug plus a set of translated names, and neither wants its own
 * copy of this.
 *
 * Matching runs against every language the thing has, not only the one
 * being displayed: a catalog may be only partly translated, so someone
 * reading it in Catalan should still find an entry by typing its Spanish
 * name.
 *
 * The `code` is matched too. It costs nothing, and it is already the
 * unaccented ASCII spelling, so it also catches anyone pasting a slug
 * straight in.
 * @param term The raw search term as typed.
 * @param code The stable slug.
 * @param names Every name it has, in any language.
 * @returns True when it should appear in the results.
 */
export function matchesSearch(term: string, code: string, names: string[]): boolean {
  const needle = foldForSearch(term.trim());
  if (!needle) return true;

  return (
    foldForSearch(code).includes(needle) ||
    names.some((name) => foldForSearch(name).includes(needle))
  );
}
