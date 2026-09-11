import { defineRouting } from "next-intl/routing";

/**
 * The app's supported languages and how they appear in URLs.
 *
 * This list lives in code rather than in the database, unlike the `locales`
 * table. The two are different things: the database table records which
 * languages *content* (ingredient names and, later, recipe titles) has been
 * translated into, which is a data question. This list records which
 * languages the *app itself* has been translated into, which is a deploy
 * question — adding one means writing a new `messages/*.json`, so it can
 * never be a runtime toggle. They are expected to stay in sync, but they
 * answer to different things.
 *
 * `localePrefix: "as-needed"` keeps Spanish, the default, on unprefixed
 * URLs (`/login`) while other languages are prefixed (`/en/login`).
 */
export const routing = defineRouting({
  locales: ["es", "ca", "en"],
  defaultLocale: "es",
  localePrefix: "as-needed",
});
