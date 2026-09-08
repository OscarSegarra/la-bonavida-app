import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { MemberRole } from "../domain/validation";

type Client = SupabaseClient<Database>;

/**
 * Generates a single-use invite link for a household. `token`,
 * `invited_by`, and `created_at` are all server-set defaults (see the
 * column-level `grant insert (household_id, role)` in the migration) -
 * the caller can never influence them. RLS requires the caller be an
 * owner; a trigger enforces the 5/day/household and 10/day/person rate
 * limits and raises a friendly error past either cap.
 * @param supabase A Supabase client scoped to the current request/session.
 * @param householdId The household to invite someone into.
 * @param role The role the link grants on acceptance (`"owner"` or
 * `"member"`).
 * @returns The new invite's token - the caller builds `/invites/<token>`
 * from it. Throws if the insert is rejected (not an owner, rate limit hit).
 */
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

/**
 * Lists a household's pending (unused, unexpired-or-not-yet-swept) invite
 * links, one joined query with who created each one. RLS restricts this
 * to owners - a plain member gets zero rows back, not an error.
 * @param supabase A Supabase client scoped to the current request/session.
 * @param householdId The household whose pending invites to list.
 * @returns An array of `{ id, role, createdAt, invitedByAlias }`, newest
 * first. `invitedByAlias` is `"(unknown)"` if the inviter's profile was
 * later deleted (`invited_by` is nullable - see
 * `household_invites_invited_by_fkey`'s `on delete set null`).
 */
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

/**
 * Revokes (deletes) a pending invite link before it's used. RLS allows
 * any owner of the invite's household to do this, not just whoever
 * generated it - `invited_by` is an audit trail, not a permission check.
 * @param supabase A Supabase client scoped to the current request/session.
 * @param inviteId The `household_invites` row to delete.
 * @returns Nothing on success; throws if the delete is rejected (not an
 * owner of that household).
 */
export async function revokeInvite(supabase: Client, inviteId: number) {
  const { error } = await supabase
    .from("household_invites")
    .delete()
    .eq("id", inviteId);
  if (error) throw error;
}

/**
 * Looks up what a token grants, without accepting it - wraps the
 * `get_household_invite` SQL function, which bypasses normal
 * `household_invites` RLS (owner-only) for this one narrow, token-scoped
 * read so a non-member can see what they're about to join. Can't be used
 * to enumerate invites - it only ever answers for the one exact token
 * supplied, and only if it's unexpired.
 * @param supabase A Supabase client scoped to the current request/session
 * (must be signed in - the underlying RPC is not callable by `anon`).
 * @param token The invite token from the `/invites/<token>` URL.
 * @returns `{ household_id, household_name, role }`, or `null`/`undefined`
 * if the token doesn't exist or has expired (never throws for that case -
 * `.maybeSingle()` on zero rows is not an error).
 */
export async function getInviteByToken(supabase: Client, token: string) {
  const { data, error } = await supabase
    .rpc("get_household_invite", { _token: token })
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Accepts an invite: wraps the `accept_household_invite` SQL function,
 * which atomically inserts the caller's membership row and deletes the
 * invite (single-use) in one transaction, `for update`-locked against a
 * concurrent accept of the same token. If the caller is already a member,
 * it just consumes the invite without erroring or duplicating.
 * @param supabase A Supabase client scoped to the current request/session.
 * @param token The invite token being accepted.
 * @returns The joined household's numeric id. Throws if the token is
 * invalid/expired (a Postgres exception surfaces as a thrown error here).
 */
export async function acceptInvite(supabase: Client, token: string) {
  const { data, error } = await supabase.rpc("accept_household_invite", {
    _token: token,
  });
  if (error) throw error;
  return data;
}
