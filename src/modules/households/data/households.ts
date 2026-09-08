import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Lists every household the signed-in user belongs to, with their role in
 * each - used to decide onboarding (none yet -> create) and for switching
 * between households.
 * @param supabase A Supabase client scoped to the current request/session.
 * @returns An array of `{ id, name, role }`; empty if there's no session
 * or the user belongs to no households.
 */
export async function getMyHouseholds(supabase: Client) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("household_members")
    .select("role, households(id, name)")
    .eq("user_id", user.id);

  if (error) throw error;
  return data.map((row) => ({ ...row.households, role: row.role }));
}

/**
 * Looks up a single household by id (name only - roster is a separate
 * call, see `data/members.ts`'s `getRoster`).
 * @param supabase A Supabase client scoped to the current request/session.
 * @param householdId The household's numeric id.
 * @returns `{ id, name }`, or `null` if it doesn't exist or RLS hides it
 * (the caller isn't a member).
 */
export async function getHousehold(supabase: Client, householdId: number) {
  const { data, error } = await supabase
    .from("households")
    .select("id, name")
    .eq("id", householdId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Creates a household and makes the caller its first owner.
 *
 * NOTE (found while documenting this function): the household insert and
 * the owner-membership insert are two separate statements, not one atomic
 * transaction/RPC. If the second insert fails after the first succeeds
 * (network blip, unexpected RLS/constraint failure), the household is
 * left orphaned - it exists with zero members and nobody can ever manage
 * or delete it through the app (every household action requires being a
 * member). Low-probability today under normal use, but worth the same
 * atomic-RPC treatment `accept_household_invite` already got, if this
 * comes up again.
 * @param supabase A Supabase client scoped to the current request/session.
 * @param name The household's name (not validated here - see
 * `domain/validation.ts`'s `validateHouseholdName`, and the DB check
 * constraints).
 * @returns The new household `{ id, name }`. Throws if there's no
 * session, or if either insert is rejected.
 */
export async function createHousehold(supabase: Client, name: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: household, error: householdError } = await supabase
    .from("households")
    .insert({ name })
    .select("id, name")
    .single();
  if (householdError) throw householdError;

  const { error: memberError } = await supabase
    .from("household_members")
    .insert({ household_id: household.id, user_id: user.id, role: "owner" });
  if (memberError) throw memberError;

  return household;
}

/**
 * Renames a household. RLS restricts this to owners of that household -
 * this function has no role check of its own.
 * @param supabase A Supabase client scoped to the current request/session.
 * @param householdId The household to rename.
 * @param name The new name (not validated here - see
 * `domain/validation.ts`'s `validateHouseholdName`, and the DB check
 * constraints).
 * @returns Nothing on success; throws if the update is rejected (e.g. the
 * caller isn't an owner).
 */
export async function renameHousehold(
  supabase: Client,
  householdId: number,
  name: string,
) {
  const { error } = await supabase
    .from("households")
    .update({ name })
    .eq("id", householdId);
  if (error) throw error;
}

/**
 * Permanently deletes a household. RLS restricts this to owners; cascades
 * to delete its `household_members` and `household_invites` rows (the
 * zero-owner guard trigger explicitly allows this cascade even for a
 * sole owner - see `private.enforce_min_one_owner`).
 * @param supabase A Supabase client scoped to the current request/session.
 * @param householdId The household to delete.
 * @returns Nothing on success; throws if the delete is rejected (e.g. the
 * caller isn't an owner).
 */
export async function deleteHousehold(supabase: Client, householdId: number) {
  const { error } = await supabase
    .from("households")
    .delete()
    .eq("id", householdId);
  if (error) throw error;
}
