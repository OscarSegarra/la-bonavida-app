-- profiles: minimal public identity for a user (an alias only), since
-- auth.users/email is never exposed to the client via the API. Required
-- immediately after first login, before onboarding or accepting an
-- invite. No trigger auto-creates this row - the value must come from the
-- user, so the "set your alias" action IS the insert. Its existence is
-- the completion signal for that one-time step; editable anytime after.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  alias text not null check (length(trim(alias)) > 0),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

-- Readable by yourself always, or by anyone you share a household with
-- (needed to show roster aliases and "invited by" labels). This reuses
-- household_members' own "any member sees the roster" policy via a plain
-- subquery - no SECURITY DEFINER helper needed, since the querying user
-- already has legitimate SELECT access to both sides of the join.
create policy profiles_select on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.household_members mine
      join public.household_members theirs
        on theirs.household_id = mine.household_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = profiles.id
    )
  );

-- Only yourself, once (the primary key prevents a second insert).
create policy profiles_insert on public.profiles
  for insert
  to authenticated
  with check (id = (select auth.uid()));

-- Editable anytime afterward - required once, never locked.
create policy profiles_update on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- household_members.user_id must reference a profile, not auth.users
-- directly. This makes "you must have set an alias before joining a
-- household" a real constraint Postgres enforces, not just a UI
-- convention - still transitively tied to auth.users via profiles' own FK.
alter table public.household_members
  drop constraint household_members_user_id_fkey,
  add constraint household_members_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade;

-- Zero-owner guard: a household must never end up with no owners. Blocks
-- removing or demoting the last owner. Implemented as a general invariant
-- (not a self-action check) - in practice these coincide, since only
-- owners can remove/demote a member at all, so when exactly one owner
-- remains, they'd have to be the one acting - but the guard doesn't rely
-- on that coincidence. Race-safe: locks the household's owner rows before
-- counting, so two concurrent removals/demotions of two different owners
-- can't each read "someone else is still an owner" and both proceed.
-- Skips the check entirely when the household itself is being deleted
-- (the other allowed escape hatch) - cascading member deletes from a
-- household delete must not be blocked by this guard.
create or replace function private.enforce_min_one_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  remaining_owners int;
begin
  if OLD.role <> 'owner' then
    return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'UPDATE' and NEW.role = 'owner' then
    return NEW;
  end if;

  if not exists (select 1 from public.households where id = OLD.household_id) then
    return coalesce(NEW, OLD);
  end if;

  with locked as (
    select id from public.household_members
    where household_id = OLD.household_id and role = 'owner'
    for update
  )
  select count(*) into remaining_owners from locked where id <> OLD.id;

  if remaining_owners = 0 then
    raise exception 'Cannot remove the last owner of a household. Promote another member to owner first, or delete the household instead.';
  end if;

  return coalesce(NEW, OLD);
end;
$$;

create trigger household_members_enforce_min_one_owner
  before update or delete on public.household_members
  for each row
  execute function private.enforce_min_one_owner();
