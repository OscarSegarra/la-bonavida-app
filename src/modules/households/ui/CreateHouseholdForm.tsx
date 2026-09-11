"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { useActionError } from "./useActionError";
import { submitCreateHousehold } from "../domain/actions";

export function CreateHouseholdForm() {
  const t = useTranslations("CreateHousehold");
  const [state, formAction, pending] = useActionState(submitCreateHousehold, {});
  const actionError = useActionError(state);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-black dark:text-zinc-50">
          {t("label")}
        </span>
        <input
          name="name"
          maxLength={100}
          required
          placeholder={t("placeholder")}
          className="rounded-md border border-black/10 bg-white px-3 py-2 text-black dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>
      {actionError && (
        <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
      >
        {pending ? t("pending") : t("submit")}
      </button>
    </form>
  );
}
