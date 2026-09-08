"use client";

import { useState, useTransition } from "react";
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
  const [role, setRole] = useState<MemberRole>("member");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    setError(null);
    setLink(null);
    startTransition(async () => {
      const result = await submitCreateInviteLink(householdId, role);
      if (result.error) {
        setError(result.error);
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
          Member
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="role"
            checked={role === "owner"}
            onChange={() => setRole("owner")}
          />
          Owner
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
        >
          {pending ? "Generating…" : "Generate invite link"}
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {link && (
        <p className="break-all rounded-md border border-black/10 bg-zinc-50 p-2 text-xs dark:border-white/10 dark:bg-zinc-900">
          {link} <span className="text-zinc-500">(expires in 7 days, single use)</span>
        </p>
      )}
    </div>
  );
}
