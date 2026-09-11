import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "@/i18n/navigation";
import { LoginForm } from "./LoginForm";
import { LocaleSwitcher } from "../LocaleSwitcher";

/**
 * Sign-in page. Server Component: redirects away immediately if already
 * signed in, otherwise renders the magic-link form, threading through any
 * `next` query param (e.g. from being redirected here off an invite link).
 * @param params Route params carrying the active locale.
 * @param searchParams Next.js route props - `next` is the page/path to
 * return to after signing in, read from the URL.
 * @returns Redirects to `/` if already signed in; otherwise the sign-in
 * form.
 */
export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect({ href: "/", locale });

  const { next } = await searchParams;
  const t = await getTranslations("Login");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-24 dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        {t("title")}
      </h1>
      <LoginForm next={next} />
      {/*
        The switcher lives on the sign-in page because this is the only
        screen everyone reaches before having any stored preference - a
        first-time Catalan speaker who lands on the Spanish default needs
        somewhere to change it that does not require signing in first.
      */}
      <LocaleSwitcher />
    </div>
  );
}
