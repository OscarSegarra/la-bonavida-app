"use client";

import { useActionState } from "react";
import type { ActionState } from "../domain/actions";

export function AliasForm({
  action,
  defaultValue,
  submitLabel,
  next,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  defaultValue?: string;
  submitLabel: string;
  /** Where to redirect after saving - only meaningful for the one-time create step. */
  next?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    {},
  );

  return (
    <form
      action={formAction}
      className="flex w-full max-w-sm flex-col gap-3"
    >
      {next && <input type="hidden" name="next" value={next} />}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-black dark:text-zinc-50">
          What should we call you?
        </span>
        <input
          name="alias"
          defaultValue={defaultValue}
          maxLength={60}
          required
          className="rounded-md border border-black/10 bg-white px-3 py-2 text-black dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>
      {state.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
