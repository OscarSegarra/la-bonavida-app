import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Locale-aware replacements for `next/link` and `next/navigation`.
 *
 * App code must use these rather than the Next.js originals. A plain
 * `<Link href="/households/1">` drops the locale prefix, so an English
 * user clicking it would silently land on the Spanish version; these
 * wrappers carry the active locale automatically, and `href` stays written
 * without a prefix.
 */
const navigation = createNavigation(routing);

export const { Link, usePathname, useRouter, getPathname } = navigation;

/**
 * Re-exported with an explicit type annotation, which is load-bearing and
 * not stylistic. `redirect` returns `never`, so `if (!user) redirect(...)`
 * should narrow `user` to non-null for the rest of the function - but
 * TypeScript only applies that narrowing when the callee has an *explicit*
 * type annotation. Destructuring it straight off `createNavigation()`
 * gives an inferred type, silently losing the narrowing and forcing every
 * caller into a non-null assertion. Annotating it here restores it once,
 * for every page.
 */
export const redirect: typeof navigation.redirect = navigation.redirect;
