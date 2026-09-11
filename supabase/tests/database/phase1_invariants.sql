-- pgTAP tests for Phase 1's database-level invariants: the zero-owner
-- guard, the two invite rate limits, and the accept_household_invite /
-- get_household_invite functions. These are the pieces of Phase 1's
-- business logic that live in Postgres, not TypeScript - vitest never
-- touches them, so this is the only automated coverage they get.
--
-- Run with the Supabase CLI (`supabase test db`) or `pg_prove` against any
-- Postgres with this project's migrations applied. Entirely self-contained
-- and rolled back at the end - safe to run against a real database.
-- Deliberately avoids psql meta-commands (\gset etc.) so it runs the same
-- way whether invoked via psql/pg_prove or a programmatic SQL client.

create extension if not exists pgtap;

begin;
select plan(25);

-- Fixtures: two owners, one plain member, one stranger, and one user with
-- no profile at all (for create_household's atomicity test), on a
-- household created directly (bypassing the app - this is fixture setup,
-- not something under test).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'member-c@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stranger-d@example.test', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'no-profile-e@example.test', '', now(), '{}', '{}', now(), now());

insert into public.profiles (id, alias) values
  ('00000000-0000-0000-0000-0000000000a1', 'Owner A'),
  ('00000000-0000-0000-0000-0000000000a2', 'Owner B'),
  ('00000000-0000-0000-0000-0000000000a3', 'Member C'),
  ('00000000-0000-0000-0000-0000000000a4', 'Stranger D');
-- deliberately no profiles row for a5

-- region_id became not-null in Phase 2 (20260911120000_phase2_reference_data.sql)
-- and has no column default, since a DEFAULT cannot be a subquery - so every
-- direct household insert must now resolve the default region itself, exactly
-- as create_household() does.
insert into public.households (id, name, region_id) overriding system value
  values (900001, 'Test Household', (select id from public.regions where is_default));
insert into public.household_members (household_id, user_id, role) values
  (900001, '00000000-0000-0000-0000-0000000000a1', 'owner'),
  (900001, '00000000-0000-0000-0000-0000000000a3', 'member');

-- === create_household: atomic creation ===
-- Added after finding (while documenting the function) that the original
-- two-separate-inserts TypeScript implementation would fail RLS for every
-- real user (insert...returning against households needs its own SELECT
-- policy satisfied, which a brand-new zero-member household never has
-- yet) - fixed with a SECURITY DEFINER SQL function. These assertions
-- guard both the happy path and the atomicity the fix was originally
-- meant to add.

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ select create_household('pgTAP Created House') $$,
  'create_household succeeds for a user with a profile'
);

select is(
  (select count(*) from households h
    join household_members hm on hm.household_id = h.id
    where h.name = 'pgTAP Created House' and hm.role = 'owner'
      and hm.user_id = '00000000-0000-0000-0000-0000000000a1')::int,
  1,
  'create_household made the caller the sole owner of the new household'
);

reset role;

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a5','role','authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ select create_household('Should Not Persist') $$,
  '23503',
  null,
  'create_household fails for a user with no profile (FK on household_members)'
);

reset role;

select is(
  (select count(*) from households where name = 'Should Not Persist')::int,
  0,
  'a failed create_household does not leave an orphaned household behind (atomic)'
);

-- === Zero-owner guard ===

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
set local role authenticated;

select throws_like(
  $$ update household_members set role = 'member' where household_id = 900001 and user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  '%last owner%',
  'demoting the sole owner is blocked'
);

select throws_like(
  $$ delete from household_members where household_id = 900001 and user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  '%last owner%',
  'removing the sole owner is blocked'
);

reset role;
insert into household_members (household_id, user_id, role) values (900001, '00000000-0000-0000-0000-0000000000a2', 'owner');

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ update household_members set role = 'member' where household_id = 900001 and user_id = '00000000-0000-0000-0000-0000000000a1' $$,
  'demoting an owner is fine when another owner remains'
);

reset role;
update household_members set role = 'owner' where household_id = 900001 and user_id = '00000000-0000-0000-0000-0000000000a1';

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a2','role','authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ delete from household_members where household_id = 900001 and user_id = '00000000-0000-0000-0000-0000000000a2' $$,
  'an owner may remove another owner when one remains (no tiebreaker)'
);

reset role;

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ delete from households where id = 900001 $$,
  'deleting the household itself is allowed even as the sole owner (the other escape hatch)'
);

reset role;

select is(
  (select count(*) from household_members where household_id = 900001)::int, 0,
  'deleting the household cascaded its membership rows'
);

-- === Rate limits ===

insert into households (id, name, region_id) overriding system value
  values (900002, 'Rate Limit Household', (select id from public.regions where is_default));
insert into household_members (household_id, user_id, role) values (900002, '00000000-0000-0000-0000-0000000000a1', 'owner');

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ insert into household_invites (household_id, role) select 900002, 'member' from generate_series(1,5) $$,
  '5 invites/day for one household is allowed'
);

select throws_like(
  $$ insert into household_invites (household_id, role) values (900002, 'member') $$,
  '%household has reached its daily invite-link limit%',
  'a 6th invite for the same household in the same day is blocked'
);

reset role;

-- Person-level cap: spread invites across three other households (each
-- under its own 5/day cap) so the 11th invite fails specifically on the
-- person cap, not the household cap.
insert into households (id, name, region_id) overriding system value values
  (900003, 'H3', (select id from public.regions where is_default)),
  (900004, 'H4', (select id from public.regions where is_default)),
  (900005, 'H5', (select id from public.regions where is_default));
insert into household_members (household_id, user_id, role) values
  (900003, '00000000-0000-0000-0000-0000000000a1', 'owner'),
  (900004, '00000000-0000-0000-0000-0000000000a1', 'owner'),
  (900005, '00000000-0000-0000-0000-0000000000a1', 'owner');

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ insert into household_invites (household_id, role) select 900003, 'member' from generate_series(1,4) $$,
  '4 more invites (household 3) - person total now 9, still under both caps'
);

select lives_ok(
  $$ insert into household_invites (household_id, role) values (900004, 'member') $$,
  '1 more invite (household 4) - person total now 10, at the person cap exactly'
);

select throws_like(
  $$ insert into household_invites (household_id, role) values (900005, 'member') $$,
  '%daily invite-link limit (10/day)%',
  'an 11th invite in a *different*, under-its-own-cap household is still blocked by the person cap'
);

reset role;

-- === accept_household_invite / get_household_invite ===

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
set local role authenticated;

select is(
  (select role from get_household_invite(
    (select token from household_invites where household_id = 900002 and role = 'member' order by created_at limit 1)
  )),
  'member',
  'get_household_invite returns the correct role for a valid token'
);

reset role;

-- Capture the token to accept while still privileged - the stranger
-- persona has no RLS visibility into household_invites (not an owner),
-- so this lookup has to happen before switching, not after.
create temp table test_accept_token as
select token from household_invites where household_id = 900002 and role = 'member' order by created_at limit 1;
grant select on test_accept_token to authenticated;

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a4','role','authenticated')::text, true);
set local role authenticated;

select is(
  (select accept_household_invite((select token from test_accept_token)))::int,
  900002,
  'accepting a valid invite returns the household id'
);

select is(
  (select role::text from household_members where household_id = 900002 and user_id = '00000000-0000-0000-0000-0000000000a4'),
  'member',
  'accepting inserted the membership at the invited role'
);

reset role;

-- Back to privileged for this count - stranger is now a plain member of
-- 900002, so (same RLS gap as before) they can't see household_invites
-- rows to check them either.
select is(
  (select count(*) from household_invites where household_id = 900002 and role = 'member')::int, 4,
  'accepting deleted the used invite row (single-use) - 5 created, 1 accepted, 4 remain'
);

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a4','role','authenticated')::text, true);
set local role authenticated;

select throws_like(
  $$ select accept_household_invite('this-token-does-not-exist') $$,
  '%invalid or has expired%',
  'accepting a nonexistent token raises a friendly error'
);

reset role;

-- Expired invite: backdate one, then try to accept it as the stranger -
-- who is now a plain member of 900002 (from the accept above), so also
-- needs the privileged-capture pattern (member is not owner -> no RLS
-- visibility into household_invites either).
insert into household_invites (household_id, role, created_at) values (900002, 'owner', now() - interval '8 days');

create temp table test_expired_token as
select token from household_invites where household_id = 900002 and created_at < now() - interval '7 days' limit 1;
grant select on test_expired_token to authenticated;

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a4','role','authenticated')::text, true);
set local role authenticated;

select throws_like(
  $$ select accept_household_invite((select token from test_expired_token)) $$,
  '%invalid or has expired%',
  'accepting an expired (>7 day old) invite is rejected'
);

-- Already-a-member: stranger (now a member of 900002) accepts a fresh
-- invite for the same household without erroring or duplicating.
reset role;
insert into household_invites (household_id, role) values (900002, 'owner');

create temp table test_repeat_token as
select token from household_invites where household_id = 900002 and role = 'owner' and created_at > now() - interval '1 minute' limit 1;
grant select on test_repeat_token to authenticated;

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a4','role','authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ select accept_household_invite((select token from test_repeat_token)) $$,
  'accepting an invite while already a member does not error'
);

select is(
  (select count(*) from household_members where household_id = 900002 and user_id = '00000000-0000-0000-0000-0000000000a4')::int, 1,
  'already-a-member accept did not duplicate the membership row'
);

reset role;

-- === RLS: household_invites stays owner-only ===

insert into household_members (household_id, user_id, role) values (900002, '00000000-0000-0000-0000-0000000000a3', 'member');

select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a3','role','authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*) from household_invites where household_id = 900002)::int, 0,
  'a plain member sees zero pending invites for their own household (owner-only visibility)'
);

reset role;

-- === household_members.user_id requires an existing profile ===

select throws_ok(
  $$ insert into household_members (household_id, user_id, role) values (900002, '00000000-0000-0000-0000-0000000000b9', 'member') $$,
  '23503',
  null,
  'a household_members row for a user with no profile is rejected (FK to profiles, not auth.users)'
);

select * from finish();
rollback;
