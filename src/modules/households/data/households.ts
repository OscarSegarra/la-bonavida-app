import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** Households the current user belongs to - used for onboarding and switching. */
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

export async function getHousehold(supabase: Client, householdId: number) {
  const { data, error } = await supabase
    .from("households")
    .select("id, name")
    .eq("id", householdId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Creates a household and makes the caller its first owner. */
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

export async function deleteHousehold(supabase: Client, householdId: number) {
  const { error } = await supabase
    .from("households")
    .delete()
    .eq("id", householdId);
  if (error) throw error;
}
