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

/** Runs a data/ call and turns a thrown error into a Result instead of
 * propagating - shared by every action below that needs to show its error
 * inline via useActionState rather than falling through to the nearest
 * error boundary. Never wrap a redirect() call in this - redirect works by
 * throwing internally, which this would incorrectly treat as a failure. */
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

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

export async function submitRemoveMember(
  householdId: number,
  membershipId: number,
) {
  const supabase = await createClient();
  await removeMember(supabase, membershipId);
  revalidatePath(`/households/${householdId}/settings`);
}

export async function submitLeaveHousehold(householdId: number) {
  const supabase = await createClient();
  await leaveHousehold(supabase, householdId);
  redirect("/onboarding");
}

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

export async function submitRevokeInvite(
  householdId: number,
  inviteId: number,
) {
  const supabase = await createClient();
  await revokeInvite(supabase, inviteId);
  revalidatePath(`/households/${householdId}/settings`);
}

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
