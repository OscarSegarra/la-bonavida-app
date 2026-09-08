import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { MemberRole } from "../domain/validation";

type Client = SupabaseClient<Database>;

/**
 * Fetches a household's full member roster, joined with each member's
 * alias in one query - avoids fetching members then looping to fetch each
 * profile separately (see DECISIONS.md's efficiency pass).
 * @param supabase A Supabase client scoped to the current request/session.
 * @param householdId The household whose roster to fetch.
 * @returns An array of `{ membershipId, userId, role, alias }`, ordered by
 * when each member joined; empty if RLS hides it (caller isn't a member).
 * A member whose profile lookup fails to embed shows `"(unknown)"`.
 */
export async function getRoster(supabase: Client, householdId: number) {
  const { data, error } = await supabase
    .from("household_members")
    .select("id, role, user_id, profiles(alias)")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data.map((row) => ({
    membershipId: row.id,
    userId: row.user_id,
    role: row.role as MemberRole,
    alias: row.profiles?.alias ?? "(unknown)",
  }));
}

/**
 * Looks up the signed-in user's own role in a specific household - used
 * to gate owner-only UI/actions (e.g. rename, invite management).
 * @param supabase A Supabase client scoped to the current request/session.
 * @param householdId The household to check membership in.
 * @returns `"owner"` or `"member"`, or `null` if there's no session or
 * the user isn't a member of that household.
 */
export async function getMyRole(supabase: Client, householdId: number) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("household_members")
    .select("role")
    .eq("household_id", householdId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  return (data?.role as MemberRole) ?? null;
}

/**
 * Promotes or demotes a member by changing their role. `membershipId`
 * alone is enough to scope this correctly (it's the membership row's own
 * primary key, already tied to exactly one household) - RLS additionally
 * requires the caller be an owner of that household, and the zero-owner
 * guard trigger blocks demoting a household's last owner.
 * @param supabase A Supabase client scoped to the current request/session.
 * @param membershipId The `household_members` row to update.
 * @param role The new role to set.
 * @returns Nothing on success; throws if the update is rejected (not an
 * owner, or it would leave the household with zero owners).
 */
export async function setMemberRole(
  supabase: Client,
  membershipId: number,
  role: MemberRole,
) {
  const { error } = await supabase
    .from("household_members")
    .update({ role })
    .eq("id", membershipId);
  if (error) throw error;
}

/**
 * Removes a member from a household. RLS requires the caller be an owner
 * of that household (or - via a separate path, `leaveHousehold` below -
 * removing themselves); the zero-owner guard trigger blocks removing a
 * household's last owner.
 * @param supabase A Supabase client scoped to the current request/session.
 * @param membershipId The `household_members` row to delete.
 * @returns Nothing on success; throws if the delete is rejected.
 */
export async function removeMember(supabase: Client, membershipId: number) {
  const { error } = await supabase
    .from("household_members")
    .delete()
    .eq("id", membershipId);
  if (error) throw error;
}

/**
 * Removes the signed-in user from a household (self-service leave). The
 * zero-owner guard trigger blocks this if the caller is that household's
 * last owner - they must promote someone else or delete the household
 * first (see `settings/page.tsx`'s `isSoleOwner` check, which hides this
 * action proactively in that case).
 * @param supabase A Supabase client scoped to the current request/session.
 * @param householdId The household to leave.
 * @returns Nothing on success; throws if there's no session, or the
 * delete is rejected (sole owner).
 */
export async function leaveHousehold(supabase: Client, householdId: number) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("household_members")
    .delete()
    .eq("household_id", householdId)
    .eq("user_id", user.id);
  if (error) throw error;
}
