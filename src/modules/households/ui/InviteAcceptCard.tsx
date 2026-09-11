"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { useActionError } from "./useActionError";
import { Link } from "@/i18n/navigation";
import { submitAcceptInvite } from "../domain/actions";
import type { MemberRole } from "../domain/validation";

export function InviteAcceptCard({
  token,
  householdName,
  role,
}: {
  token: string;
  householdName: string;
  role: MemberRole;
}) {
  const t = useTranslations("InviteAccept");
  const tRoles = useTranslations("Roles");
  const [state, formAction, pending] = useActionState(submitAcceptInvite, {});
  const actionError = useActionError(state);

  return (
    <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-black/10 bg-white p-6 text-sm dark:border-white/10 dark:bg-zinc-900">
      {/*
        The whole sentence is one message with placeholders, rather than
        assembled from fragments in JSX. The previous version appended "n"
        to "a" for the owner role, which is English grammar hardcoded into
        markup - untranslatable, since Spanish and Catalan inflect
        differently and some languages reorder the clause entirely.
      */}
      <p className="text-black dark:text-zinc-50">
        {t("invitation", { household: householdName, role: tRoles(role) })}
      </p>
      {actionError && (
        <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>
      )}
      <div className="flex gap-2">
        <form action={formAction}>
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
          >
            {pending ? t("joining") : t("accept")}
          </button>
        </form>
        <Link
          href="/onboarding"
          className="rounded-md border border-black/10 px-4 py-2 text-sm dark:border-white/10"
        >
          {t("decline")}
        </Link>
      </div>
    </div>
  );
}
