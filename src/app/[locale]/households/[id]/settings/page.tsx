import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { Link, redirect } from "@/i18n/navigation";
import { LocaleSwitcher } from "../../../LocaleSwitcher";
import {
  getHousehold,
  getMyRole,
  getRoster,
  getMyProfile,
  listPendingInvites,
  RenameHouseholdForm,
  Roster,
  InviteGenerator,
  InvitesList,
  AliasForm,
  ConfirmButton,
  submitUpdateAlias,
  submitLeaveHousehold,
  submitDeleteHousehold,
} from "@/modules/households";

/**
 * A household's settings page: rename, roster management, alias editing,
 * owner-only invite management, and leave/delete. Server Component.
 *
 * Real logic worth documenting: computes `isSoleOwner` from the roster
 * (mirroring `Roster.tsx`'s own `ownerCount` check) to decide whether to
 * show "Leave household" at all, or a note explaining why not - a
 * proactive UI mirror of the zero-owner guard trigger, so hitting that
 * guard (an uncaught error, caught only by `error.tsx`) is the exception,
 * not the normal path.
 * @param params Route params - `id` is the household's numeric id, as a
 * string (from the URL), and `locale` the active language.
 * @returns A 404 if `id` isn't a valid number, the household doesn't
 * exist, the caller isn't a member, or (edge case) the caller has no
 * profile despite having a session - shouldn't happen via normal
 * onboarding, but guards against a household URL bookmarked/shared before
 * completing it. Redirects to `/login` if signed out. Otherwise the full
 * settings page, with owner-only sections and the sole-owner leave-gate
 * applied.
 */
export default async function HouseholdSettingsPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const householdId = Number(id);
  if (!Number.isInteger(householdId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale });

  const [household, myRole, profile] = await Promise.all([
    getHousehold(supabase, householdId),
    getMyRole(supabase, householdId),
    getMyProfile(supabase),
  ]);
  if (!household || !myRole || !profile) notFound();

  const isOwner = myRole === "owner";
  const [roster, pendingInvites, t, tCommon, tAlias] = await Promise.all([
    getRoster(supabase, householdId),
    isOwner ? listPendingInvites(supabase, householdId) : Promise.resolve([]),
    getTranslations("Settings"),
    getTranslations("Common"),
    getTranslations("Alias"),
  ]);
  const isSoleOwner =
    isOwner && roster.filter((m) => m.role === "owner").length === 1;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="flex items-center justify-between">
        <Link
          href={`/households/${householdId}`}
          className="text-sm text-zinc-500 dark:text-zinc-400"
        >
          {tCommon("back")}
        </Link>
        <LocaleSwitcher />
      </div>

      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        {t("title", { name: household.name })}
      </h1>

      {isOwner && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {t("renameSection")}
          </h2>
          <RenameHouseholdForm householdId={householdId} currentName={household.name} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("membersSection")}
        </h2>
        <Roster
          householdId={householdId}
          members={roster}
          myUserId={user.id}
          isOwner={isOwner}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("yourNameSection")}
        </h2>
        <AliasForm
          action={submitUpdateAlias}
          defaultValue={profile.alias}
          submitLabel={tAlias("save")}
        />
      </section>

      {isOwner && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {t("inviteSection")}
          </h2>
          <InviteGenerator householdId={householdId} />
          <h3 className="mt-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t("pendingInvites")}
          </h3>
          <InvitesList householdId={householdId} invites={pendingInvites} />
        </section>
      )}

      <section className="flex flex-col gap-2 border-t border-black/10 pt-6 dark:border-white/10">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          {t("dangerZone")}
        </h2>
        <div className="flex gap-2">
          {isSoleOwner ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("soleOwnerCannotLeave")}
            </p>
          ) : (
            <form action={submitLeaveHousehold.bind(null, householdId)}>
              <ConfirmButton
                label={t("leave")}
                confirmMessage={t("leaveConfirm")}
                className="rounded-md border border-black/10 px-3 py-1.5 text-sm dark:border-white/10"
              />
            </form>
          )}
          {isOwner && (
            <form action={submitDeleteHousehold.bind(null, householdId)}>
              <ConfirmButton
                label={t("delete")}
                confirmMessage={t("deleteConfirm")}
                className="rounded-md border border-red-600/30 px-3 py-1.5 text-sm text-red-600 dark:text-red-400"
              />
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
