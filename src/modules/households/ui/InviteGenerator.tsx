"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { submitCreateInviteLink } from "../domain/actions";
import type { MemberRole } from "../domain/validation";

/**
 * Owner-only control (household settings page) for generating an invite
 * link. Client Component - needs local state for the chosen role and the
 * generated link, and calls the Server Action directly (not as a form
 * action) so it can display the returned token as a copyable URL rather
 * than navigating away.
 *
 * Real logic worth documenting: `generate()` calls `submitCreateInviteLink`
 * inside a transition, then either shows its `{ error }` (e.g. rate limit
 * hit) or builds `${origin}/invites/${token}` from the returned token -
 * the token itself never gets a redirect, only ever displayed as a link
 * the owner copies and sends elsewhere.
 * @param householdId The household to generate an invite link for.
 * @returns A role picker, a generate button, and (after a successful
 * generation) the resulting invite URL or an error message.
 */
export function InviteGenerator({ householdId }: { householdId: number }) {
  const t = useTranslations("InviteGenerator");
  const tValidation = useTranslations("Validation");
  const [role, setRole] = useState<MemberRole>("member");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    setError(null);
    setLink(null);
    startTransition(async () => {
      const result = await submitCreateInviteLink(householdId, role);
      // Same two-kinds-of-error rule as useActionError, applied inline
      // because this action is called directly rather than through
      // useActionState, so there is no ActionState to hand that hook.
      if (result.errorKey || result.error) {
        setError(
          result.errorKey ? tValidation(result.errorKey) : result.error!,
        );
        return;
      }
      setLink(`${window.location.origin}/invites/${result.token}`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="role"
            checked={role === "member"}
            onChange={() => setRole("member")}
          />
          {t("asMember")}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="role"
            checked={role === "owner"}
            onChange={() => setRole("owner")}
          />
          {t("asOwner")}
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
        >
          {pending ? t("generating") : t("generate")}
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {link && (
        <p className="break-all rounded-md border border-black/10 bg-zinc-50 p-2 text-xs dark:border-white/10 dark:bg-zinc-900">
          {link} <span className="text-zinc-500">{t("expiryNote")}</span>
        </p>
      )}
    </div>
  );
}
