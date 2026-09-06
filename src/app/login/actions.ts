"use server";

import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

export type SendMagicLinkState = { error?: string; sent?: boolean };

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
