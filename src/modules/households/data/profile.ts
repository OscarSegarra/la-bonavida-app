import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export async function getMyProfile(supabase: Client) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, alias")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createMyProfile(supabase: Client, alias: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("profiles")
    .insert({ id: user.id, alias });

  if (error) throw error;
}

export async function updateMyAlias(supabase: Client, alias: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("profiles")
    .update({ alias })
    .eq("id", user.id);

  if (error) throw error;
}
