-- Explicit Data API permissions for the review Worker.
--
-- This migration intentionally supports Supabase projects configured with
-- "Automatically expose new tables/functions" disabled. RLS remains enabled
-- without anon/authenticated policies; only the server-side service_role can
-- use the direct table operations required by the Worker and operator CLI.

revoke all privileges on table
  public.review_users,
  public.review_invites,
  public.review_sessions,
  public.review_extension_tokens,
  public.review_oauth_transactions,
  public.review_subscriptions,
  public.review_subscription_syncs,
  public.review_queue_videos,
  public.review_extension_days,
  public.review_rate_limits
from anon, authenticated;

grant usage on schema public to service_role;

grant select, update
  on table public.review_users
  to service_role;

grant select, insert, update
  on table public.review_invites
  to service_role;

grant select, insert, update
  on table public.review_sessions
  to service_role;

grant select, insert, update
  on table public.review_extension_tokens
  to service_role;

grant insert
  on table public.review_oauth_transactions
  to service_role;

grant select
  on table public.review_subscriptions,
           public.review_subscription_syncs
  to service_role;

grant select, delete
  on table public.review_queue_videos
  to service_role;

-- review_extension_days and review_rate_limits are reachable only through the
-- narrowly scoped SECURITY DEFINER functions granted in migration 001.
