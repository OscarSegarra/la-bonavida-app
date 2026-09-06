"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

export async function submitAlias(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const alias = String(formData.get("alias") ?? "");
  const next = String(formData.get("next") ?? "/onboarding");
  const invalid = validateAlias(alias);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  try {
    await createMyProfile(supabase, alias.trim());
  } catch (error) {
    return { error: errorMessage(error) };
  }
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
  try {
    await updateMyAlias(supabase, alias.trim());
  } catch (error) {
    return { error: errorMessage(error) };
  }
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
  let householdId: number;
  try {
    const household = await createHousehold(supabase, name.trim());
    householdId = household.id;
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect(`/households/${householdId}`);
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
  try {
    await renameHousehold(supabase, householdId, name.trim());
  } catch (error) {
    return { error: errorMessage(error) };
  }
  revalidatePath(`/households/${householdId}`);
  revalidatePath(`/households/${householdId}/settings`);
  return {};
}

export async function submitDeleteHousehold(householdId: number) {
  const supabase = await createClient();
  await deleteHousehold(supabase, householdId);
  redirect("/onboarding");
}

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
  try {
    const token = await createInviteLink(supabase, householdId, role);
    revalidatePath(`/households/${householdId}/settings`);
    return { token };
  } catch (error) {
    return { error: errorMessage(error) };
  }
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
  let householdId: number;
  try {
    householdId = await acceptInvite(supabase, token);
  } catch (error) {
    return { error: errorMessage(error) };
  }
  redirect(`/households/${householdId}`);
}
