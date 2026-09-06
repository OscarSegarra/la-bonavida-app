"use server";

import { createClient } from "@/lib/supabase/server";

export type SendMagicLinkState = { error?: string; sent?: boolean };

export async function sendMagicLink(
  _prev: SendMagicLinkState,
  formData: FormData,
): Promise<SendMagicLinkState> {
  const email = String(formData.get("email") ?? "").trim();
  const origin = String(formData.get("origin") ?? "");
  const next = String(formData.get("next") ?? "/onboarding");

  if (!email) return { error: "Enter your email." };
  if (!origin) return { error: "Something went wrong. Please try again." };

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
