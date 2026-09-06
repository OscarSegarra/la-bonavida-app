import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getMyProfile,
  getInviteByToken,
  InviteAcceptCard,
  AliasForm,
  submitAlias,
} from "@/modules/households";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const returnHere = `/invites/${token}`;
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(returnHere)}`);
  }

  const profile = await getMyProfile(supabase);
  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-24 dark:bg-black">
        <AliasForm action={submitAlias} submitLabel="Continue" next={returnHere} />
      </div>
    );
  }

  const invite = await getInviteByToken(supabase, token);
  if (!invite) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-6 py-24 text-center dark:bg-black">
        <p className="text-black dark:text-zinc-50">
          This invite link is invalid or has expired.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-24 dark:bg-black">
      <InviteAcceptCard
        token={token}
        householdName={invite.household_name}
        role={invite.role}
      />
    </div>
  );
}
