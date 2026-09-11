"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { useActionError } from "./useActionError";
import { submitSetHouseholdRegion } from "../domain/actions";

/**
 * Owner-only control for the household's region, which decides whose
 * seasonal calendar applies to its ingredients.
 * @param householdId The household being edited.
 * @param currentRegion The region code currently set.
 * @param regions The region codes available to choose from.
 * @returns A `<select>` and a save button.
 */
export function RegionForm({
  householdId,
  currentRegion,
  regions,
}: {
  householdId: number;
  currentRegion: string;
  regions: string[];
}) {
  const t = useTranslations("Settings");
  const tCommon = useTranslations("Common");
  const tRegions = useTranslations("regions");
  const action = submitSetHouseholdRegion.bind(null, householdId);
  const [state, formAction, pending] = useActionState(action, {});
  const actionError = useActionError(state);

  return (
    <form action={formAction} className="flex w-full max-w-sm items-end gap-2">
      <label className="flex flex-1 flex-col gap-1 text-sm">
        <span className="font-medium text-black dark:text-zinc-50">
          {t("regionLabel")}
        </span>
        <select
          name="region"
          defaultValue={currentRegion}
          className="rounded-md border border-black/10 bg-white px-3 py-2 text-black dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50"
        >
          {regions.map((code) => (
            <option key={code} value={code}>
              {tRegions(code)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-black/10 px-3 py-2 text-sm disabled:opacity-50 dark:border-white/10"
      >
        {pending ? tCommon("saving") : t("regionSave")}
      </button>
      {actionError && (
        <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>
      )}
    </form>
  );
}
