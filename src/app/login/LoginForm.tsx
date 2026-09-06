"use client";

import { useActionState, useEffect, useRef } from "react";
import { sendMagicLink } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(sendMagicLink, {});
  const originRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (originRef.current) originRef.current.value = window.location.origin;
  }, []);

  if (state.sent) {
    return (
      <p className="text-sm text-black dark:text-zinc-50">
        Check your email for a sign-in link.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-3">
      <input type="hidden" name="origin" defaultValue="" ref={originRef} />
      {next && <input type="hidden" name="next" value={next} />}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-black dark:text-zinc-50">Email</span>
        <input
          type="email"
          name="email"
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
        {pending ? "Sending…" : "Send magic link"}
      </button>
    </form>
  );
}
