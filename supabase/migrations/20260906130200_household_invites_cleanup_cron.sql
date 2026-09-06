-- Scheduled cleanup of expired invite links, built now rather than left
-- for later - a link is functionally inert past 7 days either way, but
-- without this the table just accumulates stale rows forever. Runs once
-- daily; the 7-day expiry window doesn't need anything finer-grained.

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'cleanup-expired-household-invites',
  '0 3 * * *',
  $$ delete from public.household_invites where created_at < now() - interval '7 days'; $$
);
