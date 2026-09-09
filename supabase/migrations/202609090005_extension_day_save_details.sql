-- Include the existing queue metadata needed by another browser's saved-today list.
-- The upsert, account/date/timezone filters, totals, and deletion semantics are unchanged.
-- CREATE OR REPLACE retains the existing function ownership and execution grants.

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

  select coalesce(jsonb_object_agg(youtube_video_id, jsonb_build_object(
    'source', source_id::text,
    'savedAt', saved_at,
    'present', true,
    'played', played_at is not null,
    'title', title,
    'channel', channel_name
  )), '{}'::jsonb)
    into v_saves
    from public.review_queue_videos
   where user_id = p_user_id and (saved_at at time zone v_timezone)::date = v_date;

  return jsonb_build_object('totals', v_totals, 'saves', v_saves);
end;
$$;
