import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Looks up the signed-in user's own profile row (id + alias).
 * @param supabase A Supabase client scoped to the current request/session.
 * @returns The profile `{ id, alias }`, or `null` if there's no session or
 * the user hasn't set an alias yet (no `profiles` row exists).
 */
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

/**
 * Creates the signed-in user's profile row - the one-time "what should we
 * call you?" step. Fails if a profile already exists (primary key on
 * `id`), by design: this is a create-once action, not an upsert.
 * @param supabase A Supabase client scoped to the current request/session.
 * @param alias The chosen display name (not validated here - see
 * `domain/validation.ts`'s `validateAlias`, and the DB check constraint).
 * @returns Nothing on success; throws if there's no session or the insert
 * is rejected (e.g. RLS, or a profile already exists).
 */
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

/**
 * Updates the signed-in user's alias on their existing profile row.
 * @param supabase A Supabase client scoped to the current request/session.
 * @param alias The new display name (not validated here - see
 * `domain/validation.ts`'s `validateAlias`, and the DB check constraint).
 * @returns Nothing on success; throws if there's no session or the update
 * is rejected (e.g. RLS, or no profile row exists yet to update).
 */
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
