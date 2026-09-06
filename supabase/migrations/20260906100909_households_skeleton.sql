-- Households + household_members skeleton, with RLS.
--
-- Every table in this app is scoped to a household. This migration lays
-- the foundation that every future module (recipes, meal plans, shopping
-- lists) will reference via household_id.

create schema if not exists private;

create table public.households (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.household_members (
  id bigint generated always as identity primary key,
  household_id bigint not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create index household_members_household_id_idx on public.household_members (household_id);
create index household_members_user_id_idx on public.household_members (user_id);

-- Returns the caller's role in a household, or null if they aren't a member.
-- SECURITY DEFINER so it can read household_members without recursively
-- triggering that table's own RLS policies (which would deadlock the check).
-- Lives in `private` (never exposed via the API) and always re-derives the
-- caller's identity from auth.uid() internally, so it can't be tricked into
-- checking someone else's membership.
create or replace function private.household_role(_household_id bigint)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select role from public.household_members
  where household_id = _household_id and user_id = (select auth.uid())
  limit 1;
$$;

revoke execute on function private.household_role(bigint) from public;
grant execute on function private.household_role(bigint) to authenticated;

alter table public.households enable row level security;
alter table public.households force row level security;
alter table public.household_members enable row level security;
alter table public.household_members force row level security;

-- households: readable/writable only by members; only owners can change or
-- delete the household. Any authenticated user may create one (they become
-- its first owner via the household_members insert policy below).
create policy households_select on public.households
  for select
  to authenticated
  using ((select private.household_role(id)) is not null);

create policy households_insert on public.households
  for insert
  to authenticated
  with check (true);

create policy households_update on public.households
  for update
  to authenticated
  using ((select private.household_role(id)) = 'owner')
  with check ((select private.household_role(id)) = 'owner');

create policy households_delete on public.households
  for delete
  to authenticated
  using ((select private.household_role(id)) = 'owner');

-- household_members: any member can see the roster. Adding members requires
-- being an owner already — EXCEPT the very first member of a brand-new
-- household, who may add themselves as owner (otherwise no one could ever
-- become the first owner of a household they just created).
create policy household_members_select on public.household_members
  for select
  to authenticated
  using ((select private.household_role(household_id)) is not null);

create policy household_members_insert on public.household_members
  for insert
  to authenticated
  with check (
    (select private.household_role(household_id)) = 'owner'
    or (
      user_id = (select auth.uid())
      and role = 'owner'
      and not exists (
        select 1 from public.household_members existing
        where existing.household_id = household_members.household_id
      )
    )
  );

create policy household_members_update on public.household_members
  for update
  to authenticated
  using ((select private.household_role(household_id)) = 'owner')
  with check ((select private.household_role(household_id)) = 'owner');

-- Owners can remove any member; members can remove themselves (leave).
create policy household_members_delete on public.household_members
  for delete
  to authenticated
  using (
    (select private.household_role(household_id)) = 'owner'
    or user_id = (select auth.uid())
  );
