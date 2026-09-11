import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "@/i18n/navigation";
import {
  getMyProfile,
  getInviteByToken,
  isMemberRole,
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
 *
 * Note the invite URL an owner shares carries no locale prefix, and that is
 * deliberate: the recipient's own language preference should decide what
 * they see, not the sender's. next-intl resolves it from their cookie or
 * Accept-Language on arrival.
 * @param params Route params - `token` is the invite token from the URL,
 * `locale` the active language.
 * @returns Redirects to `/login` (with `next` set to this same page) if
 * signed out; the alias form (same `next`) if no profile exists yet; an
 * "invalid or expired" message if the token doesn't resolve to anything;
 * otherwise the accept/decline card.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string; locale: string }>;
}) {
  const { token, locale } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const returnHere = `/invites/${token}`;
  if (!user) {
    redirect({
      href: `/login?next=${encodeURIComponent(returnHere)}`,
      locale,
    });
  }

  const [t, tAlias] = await Promise.all([
    getTranslations("InviteAccept"),
    getTranslations("Alias"),
  ]);

  const profile = await getMyProfile(supabase);
  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-24 dark:bg-black">
        <AliasForm
          action={submitAlias}
          submitLabel={tAlias("continue")}
          next={returnHere}
        />
      </div>
    );
  }

  const invite = await getInviteByToken(supabase, token);
  // The RPC types `role` as plain text, so narrow it before handing it to a
  // component that looks the word up in the Roles catalog - an unexpected
  // value should read as a dead link, not crash on a missing message key.
  if (!invite || !isMemberRole(invite.role)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-6 py-24 text-center dark:bg-black">
        <p className="text-black dark:text-zinc-50">{t("invalid")}</p>
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
