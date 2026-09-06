-- Single-use, expiring household invite links. Not tied to any email
-- address - an owner generates a link for a chosen role and distributes
-- it however they want, outside the app. Accepting deletes the row in the
-- same atomic step as the membership insert (that's what makes it
-- single-use); declining does nothing to the row at all. See DECISIONS.md
-- for the full reasoning and the rejected alternatives.

create table public.household_invites (
  id bigint generated always as identity primary key,
  household_id bigint not null references public.households (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  invited_by uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);

-- Unique for correctness (a collision is structurally impossible, not
-- just astronomically unlikely), not only for lookup speed. The
-- (household_id, created_at) and (invited_by, created_at) pairs serve the
-- two rate-limit triggers' count queries below (the hottest path in this
-- feature) and double as the index the owner-only pending-invites list
-- needs ("unused invites for this household/person, newest first").
create unique index household_invites_token_idx on public.household_invites (token);
create index household_invites_household_id_created_at_idx on public.household_invites (household_id, created_at);
create index household_invites_invited_by_created_at_idx on public.household_invites (invited_by, created_at);

alter table public.household_invites enable row level security;
alter table public.household_invites force row level security;

-- Owner-only visibility - members don't need to see pending invite links.
create policy household_invites_select on public.household_invites
  for select
  to authenticated
  using ((select private.household_role(household_id)) = 'owner');

-- Only an owner may generate a link, for their own household.
create policy household_invites_insert on public.household_invites
  for insert
  to authenticated
  with check ((select private.household_role(household_id)) = 'owner');

-- Revocable by any owner, not just the one who generated it - owners are
-- peers with no tiebreakers elsewhere in this design. If the generating
-- owner later leaves the household, the link stays valid (it belongs to
-- the household, not to them) - invited_by is an audit trail only, not a
-- validity condition, and this delete policy doesn't reference it at all.
create policy household_invites_delete on public.household_invites
  for delete
  to authenticated
  using ((select private.household_role(household_id)) = 'owner');

-- Column-level grants: the client may only ever supply household_id and
-- role. token, invited_by, id, and created_at are always server-set
-- (defaults above) - this is enforced before RLS is even evaluated, not
-- just left to application discipline.
revoke insert on public.household_invites from authenticated;
grant insert (household_id, role) on public.household_invites to authenticated;

-- Two-tier rate limit, enforced in the database on every insert attempt:
-- at most 5 new links per day per household (a shared household-level
-- budget, regardless of which owner creates them), and separately at
-- most 10 new links per day per person across every household they own.
-- SECURITY DEFINER: the person-level check must see this person's total
-- across ALL their households, including ones they may no longer be an
-- owner of (and thus couldn't otherwise SELECT under the owner-only
-- policy above) - without this, the global cap could be undercounted.
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
  select count(*) into household_count
    from public.household_invites
    where household_id = NEW.household_id
      and created_at > now() - interval '1 day';
  if household_count >= 5 then
    raise exception 'This household has reached its daily invite-link limit (5/day). Try again tomorrow.';
  end if;

  select count(*) into person_count
    from public.household_invites
    where invited_by = NEW.invited_by
      and created_at > now() - interval '1 day';
  if person_count >= 10 then
    raise exception 'You have reached your daily invite-link limit (10/day) across all your households.';
  end if;

  return NEW;
end;
$$;

create trigger household_invites_rate_limit
  before insert on public.household_invites
  for each row
  execute function private.enforce_invite_rate_limits();

-- Token-based lookup/accept. A non-member visiting /invites/<token> has no
-- RLS-granted access to household_invites at all (it stays owner-only,
-- above) - so both of these bypass normal row visibility for this one
-- narrow case, the same way private.household_role does for the
-- recursion problem. Neither can be used to enumerate invites: each only
-- ever answers for the one exact token the caller already supplies.
-- Both live in `public` (not `private`) because they must be callable
-- directly by the client via supabase.rpc() - `private` is deliberately
-- never exposed through the API.
create or replace function public.get_household_invite(_token text)
returns table (household_id bigint, household_name text, role text)
language sql
security definer
set search_path = ''
stable
as $$
  select hi.household_id, h.name, hi.role
  from public.household_invites hi
  join public.households h on h.id = hi.household_id
  where hi.token = _token
    and hi.created_at > now() - interval '7 days'
  limit 1;
$$;

revoke all on function public.get_household_invite(text) from public;
grant execute on function public.get_household_invite(text) to authenticated;

-- Inserts the membership row and deletes the invite in one transaction -
-- this atomicity is what makes accepting single-use, and avoids a
-- half-applied state if a second step could fail independently. Handles
-- "already a member" gracefully (just consumes the invite) rather than
-- surfacing a raw unique-constraint error.
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
  limit 1;

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

revoke all on function public.accept_household_invite(text) from public;
grant execute on function public.accept_household_invite(text) to authenticated;
