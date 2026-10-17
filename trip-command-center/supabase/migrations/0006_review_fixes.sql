-- Fixes from the pre-deploy review.

-- A brief record outlives its trip. Merging or splitting trips deletes trip
-- rows; with a cascade the record of a sent brief went with them and the
-- cron sent the same plan again under the new trip id. The cron now also
-- checks payload->segment_ids of briefs already sent for that date.
alter table public.briefs alter column trip_id drop not null;
alter table public.briefs drop constraint briefs_trip_id_fkey;
alter table public.briefs
  add constraint briefs_trip_id_fkey foreign key (trip_id) references public.trips (id) on delete set null;

-- Short exclusive leases (src/lib/lease.ts). Two forwarded emails processed at
-- once each read the user's segments and regroup trips; a lease per user makes
-- them take turns. Service role only: RLS on, no policies.
create table public.job_leases (
  key text primary key,
  holder uuid not null,
  expires_at timestamptz not null
);

alter table public.job_leases enable row level security;
