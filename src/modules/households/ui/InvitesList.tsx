import { submitRevokeInvite } from "../domain/actions";
import type { MemberRole } from "../domain/validation";

type Invite = {
  id: number;
  role: MemberRole;
  createdAt: string;
  invitedByAlias: string;
};

export function InvitesList({
  householdId,
  invites,
}: {
  householdId: number;
  invites: Invite[];
}) {
  if (invites.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No pending invite links.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {invites.map((invite) => (
        <li
          key={invite.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10"
        >
          <span className="text-black dark:text-zinc-50">
            {invite.role} · invited by {invite.invitedByAlias}
          </span>
          <form action={submitRevokeInvite.bind(null, householdId, invite.id)}>
            <button
              type="submit"
              className="rounded-md border border-black/10 px-2 py-1 text-xs text-red-600 dark:border-white/10 dark:text-red-400"
            >
              Revoke
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
