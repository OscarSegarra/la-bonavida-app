"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { validateAlias, validateHouseholdName, isMemberRole } from "./validation";
import { createMyProfile, updateMyAlias } from "../data/profile";
import {
  createHousehold,
  renameHousehold,
  deleteHousehold,
} from "../data/households";
import {
  setMemberRole,
  removeMember,
  leaveHousehold,
} from "../data/members";
import {
  createInviteLink,
  revokeInvite,
  acceptInvite,
} from "../data/invites";

export type ActionState = { error?: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Runs a `data/` call and turns a thrown error into a `Result` instead of
 * propagating - shared by every action below that needs to show its error
 * inline via `useActionState` rather than falling through to the nearest
 * error boundary. Never wrap a `redirect()` call in this - `redirect`
 * works by throwing internally, which this would incorrectly treat as a
 * failure.
 * @param fn The `data/` call to run.
 * @returns `{ ok: true, value }` on success, or `{ ok: false, error }`
 * (a user-facing message via `errorMessage`) if `fn` throws.
 */
async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/**
 * Server Action for the one-time "what should we call you?" step.
 * `useActionState`-shaped: called with the previous state and the
 * submitted form data.
 * @param _prev Previous action state (unused; required by `useActionState`).
 * @param formData Expects `alias` (the chosen display name) and an
 * optional `next` (where to redirect after saving - see `safeRedirectPath`,
 * defaults to `/onboarding`; used to return to an invite page if that's
 * where the user came from).
 * @returns `{ error }` if validation fails or the profile insert is
 * rejected; otherwise redirects to `next` and never returns.
 */
export async function submitAlias(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const alias = String(formData.get("alias") ?? "");
  const next = safeRedirectPath(String(formData.get("next") ?? ""), "/onboarding");
  const invalid = validateAlias(alias);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const result = await attempt(() => createMyProfile(supabase, alias.trim()));
  if (!result.ok) return { error: result.error };
  redirect(next);
}

/**
 * Server Action for editing an existing alias (household settings page).
 * @param _prev Previous action state (unused; required by `useActionState`).
 * @param formData Expects `alias` (the new display name).
 * @returns `{ error }` if validation fails or the update is rejected;
 * otherwise `{}` after revalidating every page (aliases can show up
 * anywhere a roster/invite list is rendered).
 */
export async function submitUpdateAlias(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const alias = String(formData.get("alias") ?? "");
  const invalid = validateAlias(alias);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const result = await attempt(() => updateMyAlias(supabase, alias.trim()));
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  return {};
}

/**
 * Server Action for onboarding's "create a household" step.
 * @param _prev Previous action state (unused; required by `useActionState`).
 * @param formData Expects `name` (the household's name).
 * @returns `{ error }` if validation fails or creation is rejected;
 * otherwise redirects to the new household's page and never returns.
 */
export async function submitCreateHousehold(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "");
  const invalid = validateHouseholdName(name);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const result = await attempt(() => createHousehold(supabase, name.trim()));
  if (!result.ok) return { error: result.error };
  redirect(`/households/${result.value.id}`);
}

/**
 * Server Action for renaming a household (settings page). `householdId`
 * is pre-bound via `.bind(null, householdId)` in the form's `action` prop
 * - only `_prev`/`formData` come from `useActionState`.
 * @param householdId The household to rename (bound, not form data).
 * @param _prev Previous action state (unused; required by `useActionState`).
 * @param formData Expects `name` (the new household name).
 * @returns `{ error }` if validation fails or the rename is rejected
 * (caller isn't an owner); otherwise `{}` after revalidating the
 * household's page and settings page.
 */
export async function submitRenameHousehold(
  householdId: number,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "");
  const invalid = validateHouseholdName(name);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const result = await attempt(() => renameHousehold(supabase, householdId, name.trim()));
  if (!result.ok) return { error: result.error };
  revalidatePath(`/households/${householdId}`);
  revalidatePath(`/households/${householdId}/settings`);
  return {};
}

/**
 * Server Action for permanently deleting a household (settings page,
 * "danger zone" - gated by `ConfirmButton`'s `window.confirm`). Bound
 * directly as a form's `action`, no `useActionState` involved.
 * @param householdId The household to delete.
 * @returns Never returns on success (redirects to `/onboarding`); throws
 * if the delete is rejected (caller isn't an owner), which falls through
 * to `src/app/error.tsx`.
 */
export async function submitDeleteHousehold(householdId: number) {
  const supabase = await createClient();
  await deleteHousehold(supabase, householdId);
  redirect("/onboarding");
}

// The three actions below can throw the zero-owner-guard's error (removing
// or demoting a household's last owner). They deliberately don't catch it
// - there's no inline error state wired up for these simple bound-arg
// buttons, and the UI already hides the button for the one predictable
// case (Roster.tsx / settings page's isSoleOwner checks). An uncaught
// throw here falls through to src/app/error.tsx as a safety net for any
// other path that reaches this guard.

/**
 * Server Action for promoting/demoting a member (Roster.tsx). Bound
 * directly as a form's `action` with all three args pre-supplied via
 * `.bind(null, householdId, membershipId, otherRole)` - no form fields.
 * @param householdId The household being managed (used only to
 * revalidate its settings page - not passed to the underlying query).
 * @param membershipId The `household_members` row to update.
 * @param role The new role - validated here since it arrives as a plain
 * `string` from `.bind()`, not a typed value.
 * @returns Nothing on success (revalidates the settings page); throws if
 * `role` is invalid, or if the update is rejected (not an owner, or it
 * would leave the household with zero owners).
 */
export async function submitSetMemberRole(
  householdId: number,
  membershipId: number,
  role: string,
) {
  if (!isMemberRole(role)) throw new Error("Invalid role.");
  const supabase = await createClient();
  await setMemberRole(supabase, membershipId, role);
  revalidatePath(`/households/${householdId}/settings`);
}

/**
 * Server Action for removing a member (Roster.tsx). Bound directly as a
 * form's `action` via `.bind(null, householdId, membershipId)`.
 * @param householdId The household being managed (used only to
 * revalidate its settings page).
 * @param membershipId The `household_members` row to delete.
 * @returns Nothing on success (revalidates the settings page); throws if
 * the delete is rejected (not an owner, or it would leave the household
 * with zero owners).
 */
export async function submitRemoveMember(
  householdId: number,
  membershipId: number,
) {
  const supabase = await createClient();
  await removeMember(supabase, membershipId);
  revalidatePath(`/households/${householdId}/settings`);
}

/**
 * Server Action for leaving a household (settings page, "danger zone" -
 * gated by `ConfirmButton`). Bound directly as a form's `action` via
 * `.bind(null, householdId)`.
 * @param householdId The household to leave.
 * @returns Never returns on success (redirects to `/onboarding`); throws
 * if the caller is that household's last owner (falls through to
 * `src/app/error.tsx` - though the settings page already hides this
 * button in that case via its `isSoleOwner` check).
 */
export async function submitLeaveHousehold(householdId: number) {
  const supabase = await createClient();
  await leaveHousehold(supabase, householdId);
  redirect("/onboarding");
}

/**
 * Server Action for generating an invite link (`InviteGenerator.tsx`).
 * Called directly as a function from a Client Component (not a form
 * action), so it returns a plain object rather than using
 * `useActionState`.
 * @param householdId The household to invite someone into.
 * @param role The role to grant - a plain `string` since it comes from
 * client-side component state, validated here before use.
 * @returns `{ token }` on success (the caller builds `/invites/<token>`
 * from it), or `{ error }` if `role` is invalid or creation is rejected
 * (not an owner, rate limit hit).
 */
export async function submitCreateInviteLink(
  householdId: number,
  role: string,
): Promise<{ token?: string; error?: string }> {
  if (!isMemberRole(role)) return { error: "Invalid role." };
  const supabase = await createClient();
  const result = await attempt(() => createInviteLink(supabase, householdId, role));
  if (!result.ok) return { error: result.error };
  revalidatePath(`/households/${householdId}/settings`);
  return { token: result.value };
}

/**
 * Server Action for revoking a pending invite link (`InvitesList.tsx`).
 * Bound directly as a form's `action` via `.bind(null, householdId, inviteId)`.
 * @param householdId The household being managed (used only to
 * revalidate its settings page).
 * @param inviteId The `household_invites` row to delete.
 * @returns Nothing on success (revalidates the settings page); throws if
 * the delete is rejected (not an owner of that household).
 */
export async function submitRevokeInvite(
  householdId: number,
  inviteId: number,
) {
  const supabase = await createClient();
  await revokeInvite(supabase, inviteId);
  revalidatePath(`/households/${householdId}/settings`);
}

/**
 * Server Action for accepting an invite (`InviteAcceptCard.tsx`).
 * @param _prev Previous action state (unused; required by `useActionState`).
 * @param formData Expects `token` (a hidden field - the invite token from
 * the `/invites/<token>` URL).
 * @returns `{ error }` if the token is invalid/expired; otherwise
 * redirects to the joined household's page and never returns.
 */
export async function submitAcceptInvite(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = String(formData.get("token") ?? "");
  const supabase = await createClient();
  const result = await attempt(() => acceptInvite(supabase, token));
  if (!result.ok) return { error: result.error };
  redirect(`/households/${result.value}`);
}
