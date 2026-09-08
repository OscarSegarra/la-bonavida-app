"use server";

import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

export type SendMagicLinkState = { error?: string; sent?: boolean };

/**
 * Server Action behind the login form. Triggers Supabase's magic-link
 * email - `next` (`safeRedirectPath`-validated) survives the round trip
 * as a query param on the callback URL, so an invite link followed while
 * logged out lands back on that same invite after auth completes. The
 * redirect origin comes only from the server-only `SITE_URL` env var,
 * never client input (see DECISIONS.md's open-redirect/auth-code-hijack
 * fix) - if it's unset, the action fails closed with an error rather than
 * emailing a broken or unsafe link.
 * @param _prev Previous action state (unused; required by `useActionState`).
 * @param formData Expects `email` and an optional `next` (where to send
 * the user after the magic-link callback completes).
 * @returns `{ error }` if the email is missing/invalid, `SITE_URL` isn't
 * configured, or Supabase rejects the request; otherwise `{ sent: true }`.
 */
export async function sendMagicLink(
  _prev: SendMagicLinkState,
  formData: FormData,
): Promise<SendMagicLinkState> {
  const email = String(formData.get("email") ?? "").trim();
  const next = safeRedirectPath(String(formData.get("next") ?? ""), "/onboarding");

  if (!email) return { error: "Enter your email." };

  // Never take the origin from client input - a hidden form field could be
  // set to anything in a direct POST, which would deliver the real auth
  // code straight to an attacker-controlled callback URL.
  const origin = process.env.SITE_URL;
  if (!origin) {
    return { error: "Server misconfigured (SITE_URL not set). Please contact support." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) return { error: error.message };
  return { sent: true };
}
