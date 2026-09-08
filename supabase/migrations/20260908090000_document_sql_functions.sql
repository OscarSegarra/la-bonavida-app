-- Documents every existing SQL function as real, queryable Postgres
-- metadata (visible via `\df+ <name>` or in Supabase Studio's function
-- browser), per the function-documentation convention in CLAUDE.md.
-- Purely additive - no behavior change, so this is safe to apply on top
-- of everything already committed. Not editing the original migrations'
-- own comment blocks above each `create function` (never edit an applied
-- migration) - this is the DB-level layer on top of those.

comment on function private.household_role(bigint) is
'Input: _household_id (bigint) - a household to check.
Output: text - the caller''s role (''owner''/''member'') in that household, or null if they are not a member.
Overview: the core membership check every households/household_members RLS policy is built on. SECURITY DEFINER so it can read household_members without recursively triggering that table''s own RLS policies (which would deadlock the check) - but it always re-derives the caller''s identity from auth.uid() internally, so it can never be tricked into checking someone else''s membership. STABLE (safe to call multiple times per statement). Lives in the `private` schema, never exposed via the API - only ever called from within other SQL (RLS policies, other functions).';

comment on function private.enforce_min_one_owner() is
'Input: none explicit - a BEFORE UPDATE OR DELETE trigger on household_members, reads the implicit OLD/NEW row values.
Output: the row to allow (NEW for an update, OLD for a delete) if the change is safe, or raises an exception to block it entirely.
Overview: blocks removing or demoting a household''s last remaining owner. Implemented as a general invariant (any row, not just self-action) and race-safe (locks the household''s owner rows with `for update` before counting, so two concurrent removals of two different owners can''t both read "someone else remains" and both proceed). Skips the check entirely when the household itself no longer exists - i.e. it is being deleted in the same transaction - since deleting the household is the other allowed escape hatch and its cascading membership deletes must not be blocked by this guard.';

comment on function private.enforce_invite_rate_limits() is
'Input: none explicit - a BEFORE INSERT trigger on household_invites, reads the implicit NEW row (household_id, invited_by).
Output: NEW if both rate limits are satisfied, or raises an exception naming whichever cap was hit.
Overview: enforces the two-tier invite rate limit - at most 5 new links/day for the same household, and separately at most 10 new links/day for the same person across every household they own. SECURITY DEFINER so the person-level count sees that person''s total across ALL their households, including ones they may no longer be an owner of (and thus couldn''t otherwise SELECT under household_invites'' owner-only RLS policy) - without this, the global cap could be undercounted. Uses a pg_advisory_xact_lock per household and per person to serialize concurrent invite creation for the same key, closing the same race the count-then-insert pattern would otherwise have (a legitimate second invite just waits its turn, it is not rejected).';

comment on function public.get_household_invite(text) is
'Input: _token (text) - an invite token, typically from an /invites/<token> URL.
Output: a single row of {household_id, household_name, role} if the token matches an unexpired (created within the last 7 days) invite, otherwise zero rows.
Overview: lets a non-member (or anyone) look up what a specific invite token grants, without needing SELECT access to household_invites (which stays owner-only). SECURITY DEFINER bypasses that table''s normal RLS for this one narrow, token-scoped read - it can never be used to enumerate invites, since it only ever answers for the one exact token the caller already supplies as an argument. Lives in `public` (not `private`) because it must be callable directly by the client via supabase.rpc() - `private` is deliberately never exposed through the API. EXECUTE is revoked from `anon` (Supabase grants it by default to new public-schema functions) - only `authenticated` callers may use it.';

comment on function public.accept_household_invite(text) is
'Input: _token (text) - the invite token being accepted; implicitly also uses auth.uid() for the accepting user''s identity.
Output: bigint - the id of the household the caller joined (or already belonged to). Raises an exception ("This invite is invalid or has expired.") if the token does not match any unexpired invite.
Overview: the only way a pending invite is ever consumed. Atomically inserts the caller''s household_members row at the invite''s role and deletes the invite row in one transaction - that atomicity is what makes an invite single-use, and avoids a half-applied state if a second step could fail independently. The initial lookup is `for update`-locked, so two people accepting the same token near-simultaneously can''t both pass the checks before either DELETE runs (the second call blocks until the first commits, then correctly sees the token as already gone). If the caller is already a member of the target household, it just consumes the invite without erroring or duplicating the membership row. SECURITY DEFINER for the same reason as get_household_invite - bypasses household_invites'' owner-only RLS for this one token-scoped operation. EXECUTE is revoked from `anon` - only `authenticated` callers may use it.';
