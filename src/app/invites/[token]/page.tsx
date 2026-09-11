import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getMyProfile,
  getInviteByToken,
  InviteAcceptCard,
  AliasForm,
  submitAlias,
} from "@/modules/households";

/**
 * The `/invites/<token>` landing page reached from an invite link. Server
 * Component: gates through sign-in and the required alias step (both
 * preserving `token` as the `next` destination, so the flow returns here
 * rather than dropping onto generic onboarding), then looks up and shows
 * what the token grants.
 * @param params Route params - `token` is the invite token from the URL.
 * @returns Redirects to `/login` (with `next` set to this same page) if
 * signed out; the alias form (same `next`) if no profile exists yet; an
 * "invalid or expired" message if the token doesn't resolve to anything;
 * otherwise the accept/decline card.
 */
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
