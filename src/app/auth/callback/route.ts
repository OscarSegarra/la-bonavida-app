import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";

/**
 * Magic-link callback. Exchanges the PKCE `code` Supabase appended to the
 * emailed link for a real session (setting the session cookie), then
 * redirects to `next` - re-validated here via `safeRedirectPath` even
 * though the login action already validated it once, since this URL
 * itself is user-visible/shareable and shouldn't trust its own query
 * string blindly (see DECISIONS.md's open-redirect fix).
 * @param request The incoming callback request; reads `code` and `next`
 * from its query string.
 * @returns A redirect response - to `next` on a successful code exchange,
 * or to `/login?error=auth` if there's no code or the exchange fails.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"), "/onboarding");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
