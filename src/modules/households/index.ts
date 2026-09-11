/**
 * Connector for the `households` module.
 *
 * This is the ONLY file other modules (and `src/app/**`) are allowed to
 * import from. Everything under domain/, data/, and ui/ is private to
 * this module — enforced by the boundaries ESLint rule in
 * eslint.config.mjs, not just by convention.
 */

// Reads, for Server Components to call directly during render.
export { getMyProfile } from "./data/profile";
export { getMyHouseholds, getHousehold } from "./data/households";
export { getRoster, getMyRole } from "./data/members";
export { listPendingInvites, getInviteByToken } from "./data/invites";

// Server Actions, for forms/buttons in this module's ui/ components (and
// any route that needs to trigger a mutation).
export {
  submitAlias,
  submitUpdateAlias,
  submitCreateHousehold,
  submitRenameHousehold,
  submitDeleteHousehold,
  submitSetMemberRole,
  submitRemoveMember,
  submitLeaveHousehold,
  submitCreateInviteLink,
  submitRevokeInvite,
  submitAcceptInvite,
} from "./domain/actions";

// UI building blocks for the auth/households/settings pages.
export { AliasForm } from "./ui/AliasForm";
export { CreateHouseholdForm } from "./ui/CreateHouseholdForm";
export { RenameHouseholdForm } from "./ui/RenameHouseholdForm";
export { Roster } from "./ui/Roster";
export { InviteGenerator } from "./ui/InviteGenerator";
export { InvitesList } from "./ui/InvitesList";
export { InviteAcceptCard } from "./ui/InviteAcceptCard";
export { ConfirmButton } from "./ui/ConfirmButton";

export type { MemberRole } from "./domain/validation";
export { isMemberRole } from "./domain/validation";
