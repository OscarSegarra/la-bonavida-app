import { createClient } from "@/lib/supabase/server";
import { redirect } from "@/i18n/navigation";

/**
 * Root route - a pure dispatcher, never renders anything itself. Server
 * Component: checks the session during render and redirects immediately.
 * @param params Route params carrying the active locale, which the
 * redirect has to preserve - otherwise an English visitor would be sent to
 * the Spanish sign-in page.
 * @returns Never returns - always redirects, to `/onboarding` if signed
 * in or `/login` otherwise.
 */
export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect({ href: user ? "/onboarding" : "/login", locale });
}
