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

/** Server Component - roster mutations are plain bound Server Actions, no client JS needed. */
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
  return (
    <ul className="flex flex-col gap-2">
      {members.map((member) => {
        const isSelf = member.userId === myUserId;
        const otherRole: MemberRole =
          member.role === "owner" ? "member" : "owner";

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

            {isOwner && (
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
