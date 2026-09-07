-- Villow Chrome Web Store review environment.
-- Apply only to the dedicated review Supabase project. Never apply to Villow production.

create extension if not exists pgcrypto;

create table public.review_users (
  id uuid primary key default gen_random_uuid(),
  google_subject text not null unique,
  email text,
  display_name text,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz not null,
  granted_scopes text[] not null default '{}',
  google_authorized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  access_revoked_at timestamptz
);

create table public.review_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (length(token_hash) = 43),
  label text not null check (char_length(label) between 1 and 120),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  claimed_by_user_id uuid references public.review_users(id) on delete set null,
  claimed_at timestamptz,
  allowed_uses integer not null default 1 check (allowed_uses = 1),
  use_count integer not null default 0 check (use_count between 0 and allowed_uses)
);

create table public.review_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.review_users(id) on delete cascade,
  session_token_hash text not null unique check (length(session_token_hash) = 43),
  csrf_token_hash text not null check (length(csrf_token_hash) = 43),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index review_sessions_user_idx on public.review_sessions(user_id, created_at desc);

create table public.review_extension_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.review_users(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) = 43),
  label text not null check (char_length(label) between 1 and 80),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz
);
create index review_extension_tokens_user_idx on public.review_extension_tokens(user_id, created_at desc);

create table public.review_oauth_transactions (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique check (length(state_hash) = 43),
  invite_id uuid references public.review_invites(id) on delete cascade,
  expected_user_id uuid references public.review_users(id) on delete cascade,
  encrypted_code_verifier text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check ((invite_id is not null) <> (expected_user_id is not null))
);
create index review_oauth_transactions_expiry_idx on public.review_oauth_transactions(expires_at);

create table public.review_subscriptions (
  user_id uuid not null references public.review_users(id) on delete cascade,
  youtube_channel_id text not null check (youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  channel_handle text check (channel_handle is null or char_length(channel_handle) between 1 and 100),
  channel_title text check (channel_title is null or char_length(channel_title) between 1 and 200),
  refreshed_at timestamptz not null,
  primary key (user_id, youtube_channel_id)
);

create table public.review_subscription_syncs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.review_users(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'completed', 'failed')),
  item_count integer check (item_count is null or item_count >= 0),
  safe_error_category text check (safe_error_category is null or safe_error_category in ('google_reauth_required', 'google_unavailable', 'storage_error'))
);
create index review_subscription_syncs_user_idx on public.review_subscription_syncs(user_id, started_at desc);

create table public.review_queue_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.review_users(id) on delete cascade,
  extension_token_id uuid not null references public.review_extension_tokens(id) on delete cascade,
  youtube_video_id text not null check (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (char_length(title) <= 300),
  channel_name text not null check (char_length(channel_name) <= 200),
  channel_url text not null check (char_length(channel_url) <= 500),
  thumbnail_url text not null check (char_length(thumbnail_url) <= 700),
  duration_text text not null check (char_length(duration_text) <= 16),
  is_live boolean not null,
  view_count_text text not null check (char_length(view_count_text) <= 100),
  published_text text not null check (char_length(published_text) <= 100),
  metadata_text text not null check (char_length(metadata_text) <= 500),
  source_id uuid not null,
  client text not null check (client in ('Chrome', 'Firefox', 'Edge', 'Opera', 'Brave', 'Browser')),
  metadata_version smallint not null check (metadata_version = 1),
  saved_at timestamptz not null default now(),
  played_at timestamptz,
  unique (user_id, youtube_video_id)
);
create index review_queue_videos_user_saved_idx on public.review_queue_videos(user_id, saved_at desc);

create table public.review_extension_days (
  user_id uuid not null references public.review_users(id) on delete cascade,
  source_id uuid not null,
  local_date date not null,
  timezone text not null check (char_length(timezone) between 1 and 64),
  client text not null check (client in ('Chrome', 'Firefox', 'Edge', 'Opera', 'Brave', 'Browser')),
  recommendations_seen integer not null check (recommendations_seen >= 0),
  active_seconds integer not null check (active_seconds between 0 and 86400),
  external_saves integer not null check (external_saves >= 0),
  recommendation_limit_per_day integer check (recommendation_limit_per_day is null or recommendation_limit_per_day >= 0),
  save_limit_per_day integer check (save_limit_per_day is null or save_limit_per_day >= 0),
  time_limit_seconds_per_day integer check (time_limit_seconds_per_day is null or time_limit_seconds_per_day between 0 and 86400),
  youtube_blocked boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, source_id, local_date)
);

create table public.review_rate_limits (
  scope text not null,
  key_hash text not null,
  bucket_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key (scope, key_hash, bucket_start)
);

alter table public.review_users enable row level security;
alter table public.review_invites enable row level security;
alter table public.review_sessions enable row level security;
alter table public.review_extension_tokens enable row level security;
alter table public.review_oauth_transactions enable row level security;
alter table public.review_subscriptions enable row level security;
alter table public.review_subscription_syncs enable row level security;
alter table public.review_queue_videos enable row level security;
alter table public.review_extension_days enable row level security;
alter table public.review_rate_limits enable row level security;

-- No browser role receives a policy. Only the Worker service role and the narrowly scoped RPCs operate on review data.

create or replace function public.consume_review_oauth_transaction(p_state_hash text)
returns table(id uuid, invite_id uuid, expected_user_id uuid, encrypted_code_verifier text)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.review_oauth_transactions
     set consumed_at = now()
   where state_hash = p_state_hash
     and consumed_at is null
     and expires_at > now()
  returning id, invite_id, expected_user_id, encrypted_code_verifier;
$$;

create or replace function public.complete_review_oauth(
  p_invite_id uuid,
  p_expected_user_id uuid,
  p_google_subject text,
  p_email text,
  p_display_name text,
  p_encrypted_access_token text,
  p_encrypted_refresh_token text,
  p_access_token_expires_at timestamptz,
  p_granted_scopes text[]
)
returns table(user_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_invite public.review_invites%rowtype;
  v_subject text;
begin
  if (p_invite_id is null) = (p_expected_user_id is null) then
    raise exception using errcode = 'P0001', message = 'Exactly one OAuth binding is required';
  end if;

  if p_expected_user_id is not null then
    select id, google_subject into v_user_id, v_subject
      from public.review_users where id = p_expected_user_id for update;
    if v_user_id is null or v_subject <> p_google_subject then
      raise exception using errcode = 'P0001', message = 'Reconnect must use the same Google account';
    end if;
  else
    select * into v_invite from public.review_invites where id = p_invite_id for update;
    if v_invite.id is null or v_invite.revoked_at is not null or v_invite.expires_at <= now() then
      raise exception using errcode = 'P0001', message = 'Invitation is invalid';
    end if;
    select id into v_user_id from public.review_users where google_subject = p_google_subject;
    if v_invite.claimed_by_user_id is not null then
      if v_user_id is null or v_invite.claimed_by_user_id <> v_user_id then
        raise exception using errcode = 'P0001', message = 'Invitation is bound to a different Google account';
      end if;
    else
      if v_invite.use_count >= v_invite.allowed_uses then
        raise exception using errcode = 'P0001', message = 'Invitation is no longer available';
      end if;
      if v_user_id is null then
        insert into public.review_users (
          google_subject, email, display_name, encrypted_access_token, encrypted_refresh_token,
          access_token_expires_at, granted_scopes
        ) values (
          p_google_subject, p_email, p_display_name, p_encrypted_access_token, p_encrypted_refresh_token,
          p_access_token_expires_at, p_granted_scopes
        ) returning id into v_user_id;
      end if;
      update public.review_invites
         set claimed_by_user_id = v_user_id, claimed_at = now(), use_count = use_count + 1
       where id = v_invite.id;
    end if;
  end if;

  update public.review_users
     set email = coalesce(p_email, email),
         display_name = coalesce(p_display_name, display_name),
         encrypted_access_token = p_encrypted_access_token,
         encrypted_refresh_token = coalesce(p_encrypted_refresh_token, encrypted_refresh_token),
         access_token_expires_at = p_access_token_expires_at,
         granted_scopes = p_granted_scopes,
         google_authorized_at = now(),
         last_login_at = now(),
         access_revoked_at = null
   where id = v_user_id;

  return query select v_user_id;
end;
$$;

create or replace function public.save_review_queue_video(
  p_user_id uuid,
  p_extension_token_id uuid,
  p_youtube_video_id text,
  p_title text,
  p_channel_name text,
  p_channel_url text,
  p_duration_text text,
  p_is_live boolean,
  p_view_count_text text,
  p_published_text text,
  p_metadata_text text,
  p_thumbnail_url text,
  p_source_id uuid,
  p_client text,
  p_metadata_version smallint
)
returns table(inserted boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.review_extension_tokens
     where id = p_extension_token_id and user_id = p_user_id and revoked_at is null and expires_at > now()
  ) then
    raise exception using errcode = 'P0001', message = 'Extension token is not active';
  end if;
  begin
    insert into public.review_queue_videos (
      user_id, extension_token_id, youtube_video_id, title, channel_name, channel_url,
      duration_text, is_live, view_count_text, published_text, metadata_text,
      thumbnail_url, source_id, client, metadata_version
    ) values (
      p_user_id, p_extension_token_id, p_youtube_video_id, p_title, p_channel_name, p_channel_url,
      p_duration_text, p_is_live, p_view_count_text, p_published_text, p_metadata_text,
      p_thumbnail_url, p_source_id, p_client, p_metadata_version
    );
    return query select true;
  exception when unique_violation then
    return query select false;
  end;
end;
$$;

create or replace function public.sync_review_extension_day(p_user_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_date date := (p_payload->>'date')::date;
  v_timezone text := p_payload->>'timezone';
  v_totals jsonb;
  v_saves jsonb;
begin
  insert into public.review_extension_days (
    user_id, source_id, local_date, timezone, client, recommendations_seen, active_seconds,
    external_saves, recommendation_limit_per_day, save_limit_per_day,
    time_limit_seconds_per_day, youtube_blocked, updated_at
  ) values (
    p_user_id,
    (p_payload->>'source')::uuid,
    v_date,
    v_timezone,
    p_payload->>'client',
    (p_payload#>>'{contributed,recommendationsSeen}')::integer,
    (p_payload#>>'{contributed,activeSeconds}')::integer,
    (p_payload#>>'{contributed,externalSaves}')::integer,
    (p_payload#>>'{config,recommendationLimitPerDay}')::integer,
    (p_payload#>>'{config,saveLimitPerDay}')::integer,
    (p_payload#>>'{config,timeLimitSecondsPerDay}')::integer,
    (p_payload#>>'{config,youTubeBlocked}')::boolean,
    now()
  )
  on conflict (user_id, source_id, local_date) do update set
    timezone = excluded.timezone,
    client = excluded.client,
    recommendations_seen = excluded.recommendations_seen,
    active_seconds = excluded.active_seconds,
    external_saves = excluded.external_saves,
    recommendation_limit_per_day = excluded.recommendation_limit_per_day,
    save_limit_per_day = excluded.save_limit_per_day,
    time_limit_seconds_per_day = excluded.time_limit_seconds_per_day,
    youtube_blocked = excluded.youtube_blocked,
    updated_at = now();

  select jsonb_build_object(
    'recommendationsSeen', coalesce(sum(recommendations_seen), 0),
    'activeSeconds', coalesce(sum(active_seconds), 0),
    'saves',
      (select count(*) from public.review_queue_videos q
        where q.user_id = p_user_id and (q.saved_at at time zone v_timezone)::date = v_date)
      + coalesce(sum(external_saves), 0)
  ) into v_totals
  from public.review_extension_days
  where user_id = p_user_id and local_date = v_date;

  select coalesce(jsonb_object_agg(youtube_video_id, jsonb_build_object('source', source_id::text)), '{}'::jsonb)
    into v_saves
    from public.review_queue_videos
   where user_id = p_user_id and (saved_at at time zone v_timezone)::date = v_date;

  return jsonb_build_object('totals', v_totals, 'saves', v_saves);
end;
$$;

create or replace function public.get_review_queue_status(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'videos', coalesce(jsonb_object_agg(youtube_video_id, jsonb_build_object('played', played_at is not null, 'present', true)), '{}'::jsonb)
  )
  from public.review_queue_videos
  where user_id = p_user_id;
$$;

create or replace function public.begin_review_subscription_sync(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sync_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if exists (
    select 1 from public.review_subscription_syncs
     where user_id = p_user_id and status = 'completed' and completed_at > now() - interval '60 seconds'
  ) then
    return jsonb_build_object('action', 'cached');
  end if;
  if exists (
    select 1 from public.review_subscription_syncs
     where user_id = p_user_id and status = 'running' and started_at > now() - interval '90 seconds'
  ) then
    return jsonb_build_object('action', 'busy');
  end if;
  insert into public.review_subscription_syncs(user_id, status)
  values (p_user_id, 'running') returning id into v_sync_id;
  return jsonb_build_object('action', 'refresh', 'sync_id', v_sync_id);
end;
$$;

create or replace function public.complete_review_subscription_sync(p_sync_id uuid, p_user_id uuid, p_channels jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_count integer;
begin
  if not exists (
    select 1 from public.review_subscription_syncs where id = p_sync_id and user_id = p_user_id and status = 'running' for update
  ) then raise exception using errcode = 'P0001', message = 'Subscription sync is not active'; end if;

  create temporary table incoming_review_channels(
    channel_id text primary key,
    handle text,
    title text
  ) on commit drop;

  insert into incoming_review_channels(channel_id, handle, title)
  select x."channelId", nullif(trim(leading '@' from x.handle), ''), nullif(trim(x.title), '')
    from jsonb_to_recordset(p_channels) as x("channelId" text, handle text, title text)
   where x."channelId" ~ '^UC[A-Za-z0-9_-]{22}$'
     and (x.handle is null or char_length(trim(leading '@' from x.handle)) <= 100)
     and (x.title is null or char_length(trim(x.title)) <= 200)
  on conflict (channel_id) do update set handle = excluded.handle, title = excluded.title;

  delete from public.review_subscriptions where user_id = p_user_id;
  insert into public.review_subscriptions(user_id, youtube_channel_id, channel_handle, channel_title, refreshed_at)
  select p_user_id, channel_id, handle, title, v_now from incoming_review_channels;
  get diagnostics v_count = row_count;

  update public.review_subscription_syncs
     set status = 'completed', completed_at = v_now, item_count = v_count, safe_error_category = null
   where id = p_sync_id;
end;
$$;

create or replace function public.fail_review_subscription_sync(p_sync_id uuid, p_error_category text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.review_subscription_syncs
     set status = 'failed', completed_at = now(), safe_error_category = p_error_category
   where id = p_sync_id and status = 'running';
$$;

create or replace function public.count_review_subscriptions(p_user_id uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer from public.review_subscriptions where user_id = p_user_id;
$$;

create or replace function public.check_review_rate_limit(
  p_scope text,
  p_key_hash text,
  p_maximum integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_maximum < 1 or p_window_seconds < 1 then return false; end if;
  v_bucket := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.review_rate_limits(scope, key_hash, bucket_start, request_count)
  values (p_scope, p_key_hash, v_bucket, 1)
  on conflict (scope, key_hash, bucket_start) do update
    set request_count = public.review_rate_limits.request_count + 1
  returning request_count into v_count;
  delete from public.review_rate_limits where bucket_start < now() - interval '2 days';
  return v_count <= p_maximum;
end;
$$;

create or replace function public.forget_review_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.review_invites
     set revoked_at = coalesce(revoked_at, now())
   where claimed_by_user_id = p_user_id;
  delete from public.review_users where id = p_user_id;
end;
$$;

revoke all on function public.consume_review_oauth_transaction(text) from public, anon, authenticated;
revoke all on function public.complete_review_oauth(uuid, uuid, text, text, text, text, text, timestamptz, text[]) from public, anon, authenticated;
revoke all on function public.save_review_queue_video(uuid, uuid, text, text, text, text, text, boolean, text, text, text, text, uuid, text, smallint) from public, anon, authenticated;
revoke all on function public.sync_review_extension_day(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.get_review_queue_status(uuid) from public, anon, authenticated;
revoke all on function public.begin_review_subscription_sync(uuid) from public, anon, authenticated;
revoke all on function public.complete_review_subscription_sync(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_review_subscription_sync(uuid, text) from public, anon, authenticated;
revoke all on function public.count_review_subscriptions(uuid) from public, anon, authenticated;
revoke all on function public.check_review_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.forget_review_user(uuid) from public, anon, authenticated;

grant execute on function public.consume_review_oauth_transaction(text) to service_role;
grant execute on function public.complete_review_oauth(uuid, uuid, text, text, text, text, text, timestamptz, text[]) to service_role;
grant execute on function public.save_review_queue_video(uuid, uuid, text, text, text, text, text, boolean, text, text, text, text, uuid, text, smallint) to service_role;
grant execute on function public.sync_review_extension_day(uuid, jsonb) to service_role;
grant execute on function public.get_review_queue_status(uuid) to service_role;
grant execute on function public.begin_review_subscription_sync(uuid) to service_role;
grant execute on function public.complete_review_subscription_sync(uuid, uuid, jsonb) to service_role;
grant execute on function public.fail_review_subscription_sync(uuid, text) to service_role;
grant execute on function public.count_review_subscriptions(uuid) to service_role;
grant execute on function public.check_review_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.forget_review_user(uuid) to service_role;
