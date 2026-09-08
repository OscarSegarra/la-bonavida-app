-- Fixes the orphaned-household gap found while documenting
-- data/households.ts's createHousehold: it did the household insert and
-- the owner-membership insert as two separate statements, so a failure
-- between them left a memberless household nothing could ever manage or
-- delete again. Wrapping both in one Postgres function makes them atomic.

create or replace function public.create_household(_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  _household_id bigint;
begin
  insert into public.households (name) values (_name)
  returning id into _household_id;

  insert into public.household_members (household_id, user_id, role)
  values (_household_id, auth.uid(), 'owner');

  return _household_id;
end;
$$;

-- SECURITY DEFINER turned out to be required, not just a nice-to-have:
-- `insert ... returning` against a table with `force row level security`
-- also has to satisfy that table's SELECT policy for the RETURNING data
-- (Postgres applies SELECT policies to RETURNING as if it were a
-- separate SELECT). households_select requires
-- `private.household_role(id) is not null` - but a just-inserted
-- household has zero members yet, so the caller has no role in it and
-- the RETURNING clause fails RLS, rejecting the whole INSERT. This
-- affected the *original* two-statement implementation identically
-- (`.insert({name}).select("id, name")` is the same INSERT...RETURNING
-- shape) - confirmed empirically against preprod before writing this
-- comment; household creation would have been broken for every real
-- user, this was never just a theoretical atomicity nicety. SECURITY
-- DEFINER runs the function as its owner, past this RLS check entirely
-- for these two specific, fixed inserts - safe here because the function
-- takes no dynamic SQL and always uses auth.uid() internally for the
-- owner's user_id, never a client-supplied value (the same pattern
-- private.household_role and the invite functions already use).
-- Revoking from `anon` specifically (as the other SECURITY DEFINER
-- functions in this project do) is not enough here: unlike tables (where
-- Supabase grants EXECUTE directly to `anon`/`authenticated`), a newly
-- created function additionally gets EXECUTE granted to the `PUBLIC`
-- pseudo-role by plain Postgres default - and `anon` inherits through
-- `PUBLIC` regardless of any direct revoke on `anon` itself. Confirmed via
-- `information_schema.role_routine_grants`: this function had a `PUBLIC`
-- row and no separate `anon` row at all, so `revoke ... from anon` alone
-- was a silent no-op (the security advisor still flagged anon access
-- after it). Revoking from `public` (the role, not the schema-qualified
-- function name below - identical spelling, different Postgres concept)
-- is the fix that actually closes it.
revoke execute on function public.create_household(text) from public;
grant execute on function public.create_household(text) to authenticated;

comment on function public.create_household(text) is
'Input: _name (text) - the new household''s name.
Output: bigint - the new household''s id.
Overview: creates a household and makes the caller its first owner, atomically. Both inserts happen in one transaction, so a failure partway rolls back the whole thing instead of leaving an orphaned, memberless household. SECURITY DEFINER is required here, not just a nice-to-have: insert...returning against a table with force row level security must also satisfy that table''s SELECT policy for the returned row, and households_select requires an existing membership - which a brand-new, zero-member household can never have yet. Safe because the function takes no dynamic SQL and always uses auth.uid() internally for the owner''s user_id, never a client-supplied value.';
