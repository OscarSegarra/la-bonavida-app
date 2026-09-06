import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getMyProfile,
  getMyHouseholds,
  AliasForm,
  CreateHouseholdForm,
  submitAlias,
} from "@/modules/households";

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
