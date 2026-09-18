"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Search box, tag filter, and the toggle that reveals basics.
 *
 * Every control writes to the URL rather than to local state, so the
 * filtered list stays a Server Component render: the result is shareable,
 * survives a reload, and the back button works.
 * @param tags The tag codes to offer, in display order.
 * @param search The current search term, read from the URL.
 * @param tag The currently selected tag code, read from the URL.
 * @param includeBasics Whether single-ingredient entries are shown.
 * @returns The three filter controls.
 */
export function RecipeFilters({
  tags,
  search,
  tag,
  includeBasics,
}: {
  tags: string[];
  search?: string;
  tag?: string;
  includeBasics: boolean;
}) {
  const t = useTranslations("Recipes");
  const tTags = useTranslations("recipeTags");
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function apply(next: { search?: string; tag?: string; basics?: boolean }) {
    const params = new URLSearchParams();
    const term = next.search ?? search ?? "";
    const tagCode = next.tag ?? tag ?? "";
    const basics = next.basics ?? includeBasics;
    if (term.trim()) params.set("q", term.trim());
    if (tagCode) params.set("tag", tagCode);
    if (basics) params.set("basics", "1");

    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname);
    });
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex flex-1 flex-col gap-1 text-sm">
        <span className="font-medium text-black dark:text-zinc-50">
          {t("searchLabel")}
        </span>
        <input
          type="search"
          name="q"
          defaultValue={search ?? ""}
          placeholder={t("searchPlaceholder")}
          // Submitting on change would fire a navigation per keystroke;
          // this waits for the user to finish (Enter or blur).
          onBlur={(event) => apply({ search: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply({ search: event.currentTarget.value });
            }
          }}
          className="rounded-md border border-black/10 bg-white px-3 py-2 text-black dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-black dark:text-zinc-50">{t("tag")}</span>
        <select
          value={tag ?? ""}
          disabled={pending}
          onChange={(event) => apply({ tag: event.target.value })}
          className="rounded-md border border-black/10 bg-white px-3 py-2 text-black disabled:opacity-50 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="">{t("allTags")}</option>
          {tags.map((code) => (
            <option key={code} value={code}>
              {tTags(code)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 pb-2 text-sm text-black dark:text-zinc-50">
        <input
          type="checkbox"
          checked={includeBasics}
          disabled={pending}
          onChange={(event) => apply({ basics: event.target.checked })}
          className="size-4"
        />
        {t("showBasics")}
      </label>
    </div>
  );
}
