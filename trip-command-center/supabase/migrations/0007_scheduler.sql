-- Scheduled jobs run from the database, so they work on any Vercel plan
-- (Hobby runs Vercel cron jobs at most once a day; the brief needs hourly).
-- pg_cron fires each job and pg_net calls the app with the cron secret.
--
-- After the first deploy, store the app URL and CRON_SECRET in Vault once:
--   select vault.create_secret('https://<your-app>.vercel.app', 'atlas_app_url');
--   select vault.create_secret('<same value as CRON_SECRET>', 'atlas_cron_secret');
-- Until both exist the jobs do nothing.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Not in an API-exposed schema: PostgREST serves public, and this reads Vault.
create schema if not exists private;

create or replace function private.call_app_cron(path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text := (select decrypted_secret from vault.decrypted_secrets where name = 'atlas_app_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'atlas_cron_secret');
begin
  if base is null or secret is null then
    return null;
  end if;
  -- Asynchronous: the request is sent after this transaction commits, and the
  -- response lands in net._http_response for six hours.
  return net.http_get(
    url := rtrim(base, '/') || path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function private.call_app_cron(text) from public, anon, authenticated;

-- Day-before briefs: hourly, a couple of minutes past, so a 19:00 brief hour
-- sends at 19:02 in the traveler's current time zone.
select cron.schedule('atlas-briefs', '2 * * * *', $$ select private.call_app_cron('/api/cron/briefs') $$);

-- Raw emails older than 90 days.
select cron.schedule('atlas-purge', '17 8 * * *', $$ select private.call_app_cron('/api/cron/purge') $$);

-- pg_cron keeps every run in cron.job_run_details; keep two weeks.
select cron.schedule(
  'atlas-cron-history',
  '30 3 * * 0',
  $$ delete from cron.job_run_details where end_time < now() - interval '14 days' $$
);
