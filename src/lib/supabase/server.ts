import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

/**
 * Creates a Supabase client for use in Server Components, Server Actions,
 * and Route Handlers - reads/writes the session via Next.js's cookie jar.
 * `setAll` is wrapped in a try/catch because Server Components can read
 * cookies but not write them; that's fine here since `src/proxy.ts`
 * refreshes the session cookie on every request regardless.
 * @returns A `Promise` resolving to a typed `SupabaseClient<Database>`
 * bound to the current request's cookies.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component without a surrounding
            // Server Action / Route Handler — safe to ignore because
            // middleware refreshes the session on every request.
          }
        },
      },
    },
  );
}
