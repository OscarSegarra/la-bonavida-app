import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Root route - a pure dispatcher, never renders anything itself. Server
 * Component: checks the session during render and redirects immediately.
 * @returns Never returns - always redirects, to `/onboarding` if signed
 * in or `/login` otherwise.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/onboarding" : "/login");
}
