import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
 * @returns Redirects to `/login` if signed out. Otherwise: the one-time
 * alias form if no profile exists yet; a redirect to the user's first
 * household if they already have one; or the "create a household" form.
 */
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getMyProfile(supabase);
  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-24 dark:bg-black">
        <AliasForm action={submitAlias} submitLabel="Continue" />
      </div>
    );
  }

  const households = await getMyHouseholds(supabase);
  if (households.length > 0) {
    redirect(`/households/${households[0].id}`);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-24 dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Create your household
      </h1>
      <CreateHouseholdForm />
    </div>
  );
}
