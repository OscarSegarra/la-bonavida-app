"use client";

import { useActionState } from "react";
import { submitRenameHousehold } from "../domain/actions";

export function RenameHouseholdForm({
  householdId,
  currentName,
}: {
  householdId: number;
  currentName: string;
}) {
  const action = submitRenameHousehold.bind(null, householdId);
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex w-full max-w-sm items-end gap-2">
      <label className="flex flex-1 flex-col gap-1 text-sm">
        <span className="font-medium text-black dark:text-zinc-50">
          Household name
        </span>
        <input
          name="name"
          defaultValue={currentName}
          maxLength={100}
          required
          className="rounded-md border border-black/10 bg-white px-3 py-2 text-black dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-black/10 px-3 py-2 text-sm disabled:opacity-50 dark:border-white/10"
      >
        {pending ? "Saving…" : "Rename"}
      </button>
      {state.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
    </form>
  );
}
