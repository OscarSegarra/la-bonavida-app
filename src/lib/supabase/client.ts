import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/**
 * Creates a Supabase client for use in Client Components (browser-side).
 * Reads the public URL/anon key from env vars - safe to expose, RLS is the
 * real security boundary, not these credentials.
 * @returns A typed `SupabaseClient<Database>` bound to the browser session.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
