-- Phase 3 fix: let the roles that actually run Phase 3's rules reach the
-- helpers those rules are written in.
--
-- Found applying 20260912120000 to preprod, where the first real seed run
-- failed on the first ingredient with:
--
--   permission denied for schema private
--
-- Nobody held USAGE on `private` - not even `authenticated`. Phase 1's
-- private.household_role() has worked all along regardless, because it is
-- only ever called from inside an RLS POLICY expression, and Postgres
-- evaluates those with the table owner's privileges rather than the
-- querying user's. That is a genuinely different context from the one
-- Phase 3 introduced.
--
-- Phase 3 calls private helpers from two places that are NOT policy
-- expressions, and both need the caller to hold USAGE:
--
--   * a constraint-trigger body, which runs as whoever performed the
--     write - the seed script's service_role - and calls
--     private.assert_ingredient_convertible() and its siblings;
--   * public.recipe_dietary_facts(), which is called by authenticated and
--     calls private.recipe_leaf_ingredients().
--
-- WHY A GRANT RATHER THAN security definer ON EACH HELPER. Making the
-- trigger bodies definer would have worked for the first case, and would
-- have been wrong for the second: recipe_dietary_facts must read through
-- ordinary RLS so it derives facts only from rows the caller can already
-- see, and a definer function reads everything. Marking helpers definer
-- one at a time also adds a standing privilege-escalation surface for each
-- one, to solve a problem that is really about schema visibility.
--
-- WHY THIS IS SAFE. USAGE on a schema is not access to anything in it -
-- every function still enforces its own EXECUTE grant, and every query
-- inside these helpers still goes through RLS. It also does not expose
-- anything through the API: PostgREST serves only the schemas it is
-- configured with, and `private` is deliberately not one of them. The
-- schema's purpose - "not reachable over the API" - is unchanged.
--
-- anon is deliberately left out. It cannot read recipes or ingredients at
-- all, so it has nothing to reach these helpers for.

grant usage on schema private to authenticated, service_role;

comment on schema private is
'Helpers that must never be reachable over the API: PostgREST is configured with public only, so nothing here is callable by a client even though authenticated and service_role hold USAGE. They need it because Phase 3 calls these helpers from constraint-trigger bodies (which run as whoever performed the write) and from public.recipe_dietary_facts (which runs as its caller on purpose, so that it derives facts only from rows that caller can see). Phase 1''s private.household_role needed no such grant because it is only ever called from inside an RLS policy expression, which Postgres evaluates with the table owner''s privileges.';
