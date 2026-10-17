-- Findings from the Supabase advisors on the first deploy.

-- handle_new_user() is a trigger function; nothing should call it through
-- the API (/rest/v1/rpc). Postgres refuses a direct call anyway, but the
-- grant should not be there.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Foreign keys without a covering index. The user_id ones back every RLS
-- policy; source_email_id backs the review-queue placeholder lookups.
create index if not exists boarding_passes_user_idx on public.boarding_passes (user_id);
create index if not exists boarding_passes_traveler_idx on public.boarding_passes (traveler_id);
create index if not exists boarding_passes_source_email_idx on public.boarding_passes (source_email_id);
create index if not exists briefs_user_date_idx on public.briefs (user_id, for_date);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
create index if not exists segments_source_email_idx on public.segments (source_email_id);
create index if not exists travel_documents_user_idx on public.travel_documents (user_id);
create index if not exists travel_documents_traveler_idx on public.travel_documents (traveler_id);
create index if not exists travelers_user_idx on public.travelers (user_id);
create index if not exists trip_plans_user_idx on public.trip_plans (user_id);
