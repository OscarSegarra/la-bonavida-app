import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { MemberRole } from "../domain/validation";

type Client = SupabaseClient<Database>;

export async function createInviteLink(
  supabase: Client,
  householdId: number,
  role: MemberRole,
) {
  const { data, error } = await supabase
    .from("household_invites")
    .insert({ household_id: householdId, role })
    .select("token")
    .single();
  if (error) throw error;
  return data.token;
}

/** Owner-only: one joined query for the invite plus who created it. */
export async function listPendingInvites(supabase: Client, householdId: number) {
  const { data, error } = await supabase
    .from("household_invites")
    .select("id, role, created_at, profiles(alias)")
    .eq("household_id", householdId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    role: row.role as MemberRole,
    createdAt: row.created_at,
    invitedByAlias: row.profiles?.alias ?? "(unknown)",
  }));
}

export async function revokeInvite(supabase: Client, inviteId: number) {
  const { error } = await supabase
    .from("household_invites")
    .delete()
    .eq("id", inviteId);
  if (error) throw error;
}

export async function getInviteByToken(supabase: Client, token: string) {
  const { data, error } = await supabase
    .rpc("get_household_invite", { _token: token })
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Returns the joined household's id. */
export async function acceptInvite(supabase: Client, token: string) {
  const { data, error } = await supabase.rpc("accept_household_invite", {
    _token: token,
  });
  if (error) throw error;
  return data;
}
