import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "@/i18n/navigation";
import {
  getMyProfile,
  getMyHouseholds,
  AliasForm,
  CreateHouseholdForm,
  submitAlias,
} from "@/modules/households";

/**
 * Post-login landing page. Server Component: walks the required sequence
 * for a new session - signed in? has a profile/alias? belongs to a
 * household yet? - rendering whichever step is still incomplete, or
 * redirecting straight past this page once everything's in place.
 * @param params Route params carrying the active locale, preserved across
 * every redirect out of this page.
 * @returns Redirects to `/login` if signed out. Otherwise: the one-time
 * alias form if no profile exists yet; a redirect to the user's first
 * household if they already have one; or the "create a household" form.
 */
export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale });

  const [t, tAlias] = await Promise.all([
    getTranslations("Onboarding"),
    getTranslations("Alias"),
  ]);

  const profile = await getMyProfile(supabase);
  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-24 dark:bg-black">
        <AliasForm action={submitAlias} submitLabel={tAlias("continue")} />
      </div>
    );
  }

  const households = await getMyHouseholds(supabase);
  if (households.length > 0) {
    redirect({ href: `/households/${households[0].id}`, locale });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-24 dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        {t("title")}
      </h1>
      <CreateHouseholdForm />
    </div>
  );
}
