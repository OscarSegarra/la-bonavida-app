import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

export default async function HouseholdSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const householdId = Number(id);
  if (!Number.isInteger(householdId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [household, myRole, profile] = await Promise.all([
    getHousehold(supabase, householdId),
    getMyRole(supabase, householdId),
    getMyProfile(supabase),
  ]);
  if (!household || !myRole || !profile) notFound();

  const isOwner = myRole === "owner";
  const [roster, pendingInvites] = await Promise.all([
    getRoster(supabase, householdId),
    isOwner ? listPendingInvites(supabase, householdId) : Promise.resolve([]),
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
          ← Back
        </Link>
      </div>

      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        {household.name} — Settings
      </h1>

      {isOwner && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Rename household
          </h2>
          <RenameHouseholdForm householdId={householdId} currentName={household.name} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Members
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
          Your name
        </h2>
        <AliasForm
          action={submitUpdateAlias}
          defaultValue={profile.alias}
          submitLabel="Save"
        />
      </section>

      {isOwner && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Invite someone
          </h2>
          <InviteGenerator householdId={householdId} />
          <h3 className="mt-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Pending invite links
          </h3>
          <InvitesList householdId={householdId} invites={pendingInvites} />
        </section>
      )}

      <section className="flex flex-col gap-2 border-t border-black/10 pt-6 dark:border-white/10">
        <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Danger zone
        </h2>
        <div className="flex gap-2">
          {isSoleOwner ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              You&apos;re the sole owner — promote another member to owner
              before you can leave.
            </p>
          ) : (
            <form action={submitLeaveHousehold.bind(null, householdId)}>
              <ConfirmButton
                label="Leave household"
                confirmMessage="Leave this household? You'll need a new invite to rejoin."
                className="rounded-md border border-black/10 px-3 py-1.5 text-sm dark:border-white/10"
              />
            </form>
          )}
          {isOwner && (
            <form action={submitDeleteHousehold.bind(null, householdId)}>
              <ConfirmButton
                label="Delete household"
                confirmMessage="Delete this household permanently, for everyone? This can't be undone."
                className="rounded-md border border-red-600/30 px-3 py-1.5 text-sm text-red-600 dark:text-red-400"
              />
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
