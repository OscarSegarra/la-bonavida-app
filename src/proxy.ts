import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Runs before every non-static request (see `config.matcher` below).
 * Refreshes the Supabase auth session cookie so it never silently expires
 * mid-visit - this is what lets Server Components/Actions elsewhere just
 * read the session without each one re-checking or refreshing it. Passes
 * requests through untouched if Supabase env vars aren't configured for
 * this environment (e.g. prod, before `la-bonavida-prod` exists).
 * @param request The incoming Next.js request.
 * @returns A `Promise` resolving to the (possibly cookie-updated) response.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // No Supabase project wired up yet for this environment (e.g. prod,
  // deliberately deferred — see DECISIONS.md). Pass requests through
  // instead of crashing every request with a missing-config error.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshes the auth session cookie before it expires. Must run before
  // any route handler reads the session, and must finish before the
  // response is returned.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
