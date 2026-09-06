import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { MemberRole } from "../domain/validation";

type Client = SupabaseClient<Database>;

/** One joined query - avoids fetching members then looping to fetch each profile. */
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

export async function removeMember(supabase: Client, membershipId: number) {
  const { error } = await supabase
    .from("household_members")
    .delete()
    .eq("id", membershipId);
  if (error) throw error;
}

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
