-- Fixes from a code review of the Phase 1 branch. Each item below is a
-- real bug or a documented-invariant mismatch caught in review, not a
-- style preference - see the review findings in the PR / DECISIONS.md.

-- 1. accept_household_invite had a TOCTOU race: two people accepting the
-- same token at nearly the same instant could both pass the "not already
-- a member" check and both insert before either DELETE ran, granting the
-- same single-use link to two different users. Locking the row with
-- `for update` serializes concurrent accepts of the same token - the
-- second call blocks until the first commits (and deletes the row), so it
-- then correctly sees "invalid or expired" instead of double-granting.
create or replace function public.accept_household_invite(_token text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  _household_id bigint;
  _role text;
  _caller uuid := auth.uid();
begin
  select household_id, role into _household_id, _role
  from public.household_invites
  where token = _token
    and created_at > now() - interval '7 days'
  limit 1
  for update;

  if _household_id is null then
    raise exception 'This invite is invalid or has expired.';
  end if;

  if exists (
    select 1 from public.household_members
    where household_id = _household_id and user_id = _caller
  ) then
    delete from public.household_invites where token = _token;
    return _household_id;
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (_household_id, _caller, _role);

  delete from public.household_invites where token = _token;

  return _household_id;
end;
$$;

-- 2. The rate-limit trigger had the identical race shape as (1) - two
-- concurrent invite creations could each read a pre-insert count and both
-- pass the `>= limit` check, exceeding the documented caps. An advisory
-- lock per household and per person serializes concurrent invite creation
-- for the same key (blocking, not rejecting - a legitimate 2nd invite
-- just waits its turn). Also combines what were two sequential COUNT
-- scans into one, since both share the same underlying table/time window.
create or replace function private.enforce_invite_rate_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  household_count int;
  person_count int;
begin
  perform pg_advisory_xact_lock(hashtext('household_invites_household:' || NEW.household_id::text));
  perform pg_advisory_xact_lock(hashtext('household_invites_person:' || NEW.invited_by::text));

  select
    count(*) filter (where household_id = NEW.household_id),
    count(*) filter (where invited_by = NEW.invited_by)
  into household_count, person_count
  from public.household_invites
  where created_at > now() - interval '1 day'
    and (household_id = NEW.household_id or invited_by = NEW.invited_by);

  if household_count >= 5 then
    raise exception 'This household has reached its daily invite-link limit (5/day). Try again tomorrow.';
  end if;

  if person_count >= 10 then
    raise exception 'You have reached your daily invite-link limit (10/day) across all your households.';
  end if;

  return NEW;
end;
$$;

-- 3. invited_by was `on delete cascade`, contradicting the documented
-- invariant that a link "belongs to the household, not the inviter" and
-- survives the inviter leaving. Leaving a household never touched this
-- (invited_by references profiles, not household_members) - but deleting
-- the inviter's *profile* (e.g. a future account-deletion feature) would
-- have silently deleted their still-valid pending invites too. Switching
-- to `on delete set null` (and making the column nullable) means the
-- audit trail can be lost, but the invite itself never is.
alter table public.household_invites
  alter column invited_by drop not null,
  drop constraint household_invites_invited_by_fkey,
  add constraint household_invites_invited_by_fkey
    foreign key (invited_by) references public.profiles (id) on delete set null;

-- 4. validation.ts's domain-layer checks (alias <= 60 chars, household
-- name <= 100 chars) were never actually backed by a database constraint
-- - only non-emptiness was. Anyone calling the Supabase API directly
-- (normal usage for this app's own client, with the public anon key)
-- could bypass the length limits entirely. Adding the missing constraints
-- makes the domain layer's comment ("the database enforces these too")
-- true, rather than weakening the comment to match the gap.
alter table public.profiles
  add constraint profiles_alias_length check (length(alias) <= 60);

alter table public.households
  add constraint households_name_not_empty check (length(trim(name)) > 0),
  add constraint households_name_length check (length(name) <= 100);
