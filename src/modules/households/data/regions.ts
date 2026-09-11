import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Lists the regions a household can be set to.
 *
 * `regions` is shared platform reference data rather than something the
 * ingredients module owns, so reading it here directly is deliberate -
 * routing it through another module's connector would make households
 * depend on ingredients just to name a market.
 * @param supabase A Supabase client scoped to the current request/session.
 * @returns Region codes; the UI translates them.
 */
export async function listRegions(supabase: Client) {
  const { data, error } = await supabase
    .from("regions")
    .select("code")
    .order("code", { ascending: true });

  if (error) throw error;
  return data.map((row) => row.code);
}

/**
 * Sets a household's region.
 *
 * Deliberately no permission check here: the existing owner-only
 * `households_update` policy already refuses this for members and
 * non-members, and duplicating that rule in application code would mean
 * two places to keep in sync with one of them unenforceable. A rejected
 * update simply matches no rows.
 * @param supabase A Supabase client scoped to the current request/session.
 * @param householdId The household to update.
 * @param regionCode The region's stable code.
 */
export async function setHouseholdRegion(
  supabase: Client,
  householdId: number,
  regionCode: string,
) {
  const { data: region, error: lookupError } = await supabase
    .from("regions")
    .select("id")
    .eq("code", regionCode)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (!region) throw new Error(`Unknown region: ${regionCode}`);

  const { error } = await supabase
    .from("households")
    .update({ region_id: region.id })
    .eq("id", householdId);

  if (error) throw error;
}
