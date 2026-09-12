"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

/**
 * Search box and food-group filter for the ingredient list.
 *
 * The only Client Component on the page. Both controls write to the URL
 * rather than to local state, so the filtered list stays a Server
 * Component render: the result is shareable, survives a reload, and the
 * back button works. That is also why this pushes to the router instead of
 * lifting a `useState` into the page.
 * @param foodGroups The group codes to offer, in display order.
 * @param search The current search term, read from the URL.
 * @param foodGroup The currently selected group code, read from the URL.
 * @returns A search input and a group `<select>`.
 */
export function IngredientFilters({
  foodGroups,
  dietTags,
  search,
  foodGroup,
  diet,
}: {
  foodGroups: string[];
  /** Diet tags only - allergens are deliberately not offered here (see listDietaryTags). */
  dietTags: string[];
  search?: string;
  foodGroup?: string;
  diet?: string;
}) {
  const t = useTranslations("Ingredients");
  const tGroups = useTranslations("foodGroups");
  const tTags = useTranslations("dietaryTags");
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function apply(next: { search?: string; group?: string; diet?: string }) {
    const params = new URLSearchParams();
    const term = next.search ?? search ?? "";
    const group = next.group ?? foodGroup ?? "";
    const dietCode = next.diet ?? diet ?? "";
    if (term.trim()) params.set("q", term.trim());
    if (group) params.set("group", group);
    if (dietCode) params.set("diet", dietCode);

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
        <span className="font-medium text-black dark:text-zinc-50">
          {t("foodGroup")}
        </span>
        <select
          value={foodGroup ?? ""}
          disabled={pending}
          onChange={(event) => apply({ group: event.target.value })}
          className="rounded-md border border-black/10 bg-white px-3 py-2 text-black disabled:opacity-50 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="">{t("allGroups")}</option>
          {foodGroups.map((code) => (
            <option key={code} value={code}>
              {tGroups(code)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-black dark:text-zinc-50">
          {t("suitableFor")}
        </span>
        <select
          value={diet ?? ""}
          disabled={pending}
          onChange={(event) => apply({ diet: event.target.value })}
          className="rounded-md border border-black/10 bg-white px-3 py-2 text-black disabled:opacity-50 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="">{t("anyDiet")}</option>
          {dietTags.map((code) => (
            <option key={code} value={code}>
              {tTags(code)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
