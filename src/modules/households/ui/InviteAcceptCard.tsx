"use client";

import Link from "next/link";
import { useActionState } from "react";
import { submitAcceptInvite } from "../domain/actions";

export function InviteAcceptCard({
  token,
  householdName,
  role,
}: {
  token: string;
  householdName: string;
  role: string;
}) {
  const [state, formAction, pending] = useActionState(submitAcceptInvite, {});

  return (
    <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-black/10 bg-white p-6 text-sm dark:border-white/10 dark:bg-zinc-900">
      <p className="text-black dark:text-zinc-50">
        You&apos;ve been invited to join <strong>{householdName}</strong> as
        a{role === "owner" ? "n" : ""} <strong>{role}</strong>.
      </p>
      {state.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}
      <div className="flex gap-2">
        <form action={formAction}>
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-black"
          >
            {pending ? "Joining…" : "Accept"}
          </button>
        </form>
        <Link
          href="/onboarding"
          className="rounded-md border border-black/10 px-4 py-2 text-sm dark:border-white/10"
        >
          Decline
        </Link>
      </div>
    </div>
  );
}
