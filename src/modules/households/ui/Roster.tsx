import {
  submitSetMemberRole,
  submitRemoveMember,
} from "../domain/actions";
import type { MemberRole } from "../domain/validation";

type Member = {
  membershipId: number;
  userId: string;
  role: MemberRole;
  alias: string;
};

/**
 * Renders a household's member roster with owner-only promote/demote/
 * remove controls. Server Component - mutations are plain bound Server
 * Actions (`.bind(null, ...)` as a form's `action`), no client JS needed.
 *
 * Real logic worth documenting: computes `ownerCount` from `members` and,
 * for whichever row is the sole remaining owner, hides that row's
 * Demote/Remove controls and shows an explanatory note instead - a
 * proactive UI mirror of the zero-owner guard trigger, so hitting that
 * guard (an uncaught error, caught only by `src/app/error.tsx`) is the
 * exception, not the normal path.
 * @param householdId The household being managed (passed through to the
 * bound Server Actions, used only to revalidate the settings page).
 * @param members The roster to render (from `data/members.ts`'s `getRoster`).
 * @param myUserId The signed-in user's id, to label their own row "(you)".
 * @param isOwner Whether the signed-in user is an owner - only owners see
 * the promote/demote/remove controls at all.
 * @returns A `<ul>` of member rows.
 */
export function Roster({
  householdId,
  members,
  myUserId,
  isOwner,
}: {
  householdId: number;
  members: Member[];
  myUserId: string;
  isOwner: boolean;
}) {
  const ownerCount = members.filter((m) => m.role === "owner").length;

  return (
    <ul className="flex flex-col gap-2">
      {members.map((member) => {
        const isSelf = member.userId === myUserId;
        const otherRole: MemberRole =
          member.role === "owner" ? "member" : "owner";
        const isSoleOwner = member.role === "owner" && ownerCount === 1;

        return (
          <li
            key={member.membershipId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10"
          >
            <span className="text-black dark:text-zinc-50">
              {member.alias}
              {isSelf && " (you)"}
              <span className="ml-2 text-zinc-500 dark:text-zinc-400">
                {member.role}
              </span>
            </span>

            {isOwner && isSoleOwner && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Sole owner — promote someone else first
              </span>
            )}
            {isOwner && !isSoleOwner && (
              <div className="flex gap-2">
                <form
                  action={submitSetMemberRole.bind(
                    null,
                    householdId,
                    member.membershipId,
                    otherRole,
                  )}
                >
                  <button
                    type="submit"
                    className="rounded-md border border-black/10 px-2 py-1 text-xs dark:border-white/10"
                  >
                    {member.role === "owner" ? "Demote" : "Promote"}
                  </button>
                </form>
                <form
                  action={submitRemoveMember.bind(
                    null,
                    householdId,
                    member.membershipId,
                  )}
                >
                  <button
                    type="submit"
                    className="rounded-md border border-black/10 px-2 py-1 text-xs text-red-600 dark:border-white/10 dark:text-red-400"
                  >
                    Remove
                  </button>
                </form>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
