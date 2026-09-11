import { createServerClient } from "@supabase/ssr";
import createMiddleware from "next-intl/middleware";
import { type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";

const handleI18nRouting = createMiddleware(routing);

/**
 * Runs before every non-static request (see `config.matcher` below), doing
 * two independent jobs that both want to own the response: refreshing the
 * Supabase auth session cookie, and resolving the request's locale.
 *
 * The order below is deliberate and is the whole trick. Supabase runs
 * first but does not build a response; it only collects the cookies it
 * wants set and applies them to `request` as it goes. `next-intl` then
 * builds the response from that already-updated request, and the collected
 * cookies are copied onto whatever it produced.
 *
 * Doing it the other way round - the shape Supabase's own template uses -
 * breaks one of the two. That template rebuilds the response with
 * `NextResponse.next({request})` inside `setAll`, which is how a refreshed
 * cookie reaches Server Components on the same request. But `next-intl`'s
 * response is usually a *rewrite* (to `/[locale]/...`), and rebuilding it
 * as a plain `next()` throws that rewrite away, so every page 404s.
 * Setting cookies on the rewrite without rebuilding keeps routing intact
 * but loses the refreshed cookie for the current request instead.
 * Mutating `request` before `next-intl` sees it avoids the trade entirely,
 * because `request.cookies.set()` updates the underlying cookie header and
 * `next-intl` builds its rewrite from those headers.
 *
 * Passes requests through untouched if Supabase env vars aren't configured
 * for this environment (e.g. prod, before `la-bonavida-prod` exists) -
 * locale routing still runs, since it has no such dependency.
 * @param request The incoming Next.js request.
 * @returns A `Promise` resolving to the locale-routed response, carrying
 * any refreshed auth cookies.
 */
export async function proxy(request: NextRequest) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return handleI18nRouting(request);
  }

  const pendingCookies: Array<{
    name: string;
    value: string;
    options: Record<string, unknown>;
  }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Update the request first, so the response next-intl builds from
          // it carries the refreshed cookie downstream to Server Components.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          pendingCookies.push(
            ...(cookiesToSet as typeof pendingCookies),
          );
        },
      },
    },
  );

  // Refreshes the auth session cookie before it expires. Must run before
  // any route handler reads the session, and must finish before the
  // response is returned.
  await supabase.auth.getClaims();

  const response = handleI18nRouting(request);
  pendingCookies.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options),
  );

  return response;
}

export const config = {
  // Excludes Next internals, anything with a file extension, and /auth/*.
  // That last one matters: /auth/callback is the redirect target registered
  // with Supabase for magic links, and locale-prefixing it would send users
  // to a URL that no longer matches what was registered. It runs its own
  // Supabase client anyway, so it needs nothing from here.
  matcher: ["/((?!_next|auth|.*\\..*).*)"],
};
