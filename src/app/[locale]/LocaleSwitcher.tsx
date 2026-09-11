"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const LOCALE_NAMES: Record<string, string> = {
  es: "Español",
  ca: "Català",
  en: "English",
};

/**
 * Switches the interface language, keeping the user on the page they are
 * already on.
 *
 * `usePathname` here is the one from `@/i18n/navigation`, which returns the
 * path *without* the locale prefix - so replacing the locale is a matter of
 * re-pushing the same path under a different one, rather than string-editing
 * the URL.
 *
 * Each language is labelled with its own endonym ("Català", not "Catalan"),
 * which is the usual convention: someone looking for their language
 * recognises it written the way they write it, even when the current
 * interface is in a language they do not read.
 * @returns A `<select>` of the supported languages.
 */
export function LocaleSwitcher() {
  const t = useTranslations("LocaleSwitcher");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="sr-only">{t("label")}</span>
      <select
        value={locale}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          startTransition(() => {
            router.replace(pathname, { locale: next });
          });
        }}
        className="rounded-md border border-black/10 bg-transparent px-2 py-1 disabled:opacity-50 dark:border-white/10"
      >
        {routing.locales.map((code) => (
          <option key={code} value={code}>
            {LOCALE_NAMES[code] ?? code}
          </option>
        ))}
      </select>
    </label>
  );
}
