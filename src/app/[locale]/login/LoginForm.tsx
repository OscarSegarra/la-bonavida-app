"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { sendMagicLink } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations("Login");
  const tValidation = useTranslations("Validation");
  const [state, formAction, pending] = useActionState(sendMagicLink, {});
  // Inlined rather than reusing the households module's useActionError:
  // this action has its own state shape, and importing a hook out of
  // another module's ui/ would breach the connector-only boundary rule
  // for what is a single line.
  const error = state.errorKey ? tValidation(state.errorKey) : state.error;

  if (state.sent) {
    return (
      <p className="text-sm text-black dark:text-zinc-50">{t("checkEmail")}</p>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-3">
      {next && <input type="hidden" name="next" value={next} />}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-black dark:text-zinc-50">
          {t("email")}
        </span>
        <input
          type="email"
          name="email"
          required
          className="rounded-md border border-black/10 bg-white px-3 py-2 text-black dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </label>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
      >
        {pending ? t("sending") : t("send")}
      </button>
    </form>
  );
}
