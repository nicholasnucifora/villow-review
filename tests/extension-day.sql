-- Run only against a disposable database with the review migrations applied.
-- Fixtures are rolled back, and assertions execute the real aggregation function.
\set ON_ERROR_STOP on
begin;
do $test$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_token uuid := gen_random_uuid();
  v_other_token uuid := gen_random_uuid();
  v_source uuid := gen_random_uuid();
  v_second_source uuid := gen_random_uuid();
  v_payload jsonb;
  v_result jsonb;
begin
  insert into public.review_users (id, google_subject, encrypted_access_token, access_token_expires_at)
    values (v_user, v_user::text, 'test', now()), (v_other, v_other::text, 'test', now());
  insert into public.review_extension_tokens (id, user_id, token_hash, label, expires_at)
    values (v_token, v_user, repeat('a',43), 'test', now() + interval '1 day'),
           (v_other_token, v_other, repeat('b',43), 'test', now() + interval '1 day');
  insert into public.review_queue_videos (
    user_id, extension_token_id, youtube_video_id, title, channel_name, channel_url,
    thumbnail_url, duration_text, is_live, view_count_text, published_text, metadata_text,
    source_id, client, metadata_version, saved_at
  )
  select v_user, v_token, id, '', '', '', '', '', false, '', '', '', v_source, 'Chrome', 1, saved_at
  from (values
    ('aaaaaaaaaaa', timestamptz '2026-09-06 13:59:59+00'),
    ('bbbbbbbbbbb', timestamptz '2026-09-06 14:00:00+00'),
    ('ccccccccccc', timestamptz '2026-09-07 13:59:59+00'),
    ('ddddddddddd', timestamptz '2026-09-07 14:00:00+00'),
    ('eeeeeeeeeee', timestamptz '2026-10-03 13:59:59+00'),
    ('fffffffffff', timestamptz '2026-10-03 14:00:00+00'),
    ('ggggggggggg', timestamptz '2026-10-04 12:59:59+00'),
    ('hhhhhhhhhhh', timestamptz '2026-10-04 13:00:00+00')
  ) as fixtures(id, saved_at);
  insert into public.review_queue_videos (
    user_id, extension_token_id, youtube_video_id, title, channel_name, channel_url,
    thumbnail_url, duration_text, is_live, view_count_text, published_text, metadata_text,
    source_id, client, metadata_version, saved_at
  ) values (v_other, v_other_token, 'iiiiiiiiiii', '', '', '', '', '', false, '', '', '', v_second_source, 'Firefox', 1, '2026-09-06 14:00:00+00');
  v_payload := jsonb_build_object(
    'date', '2026-09-07', 'timezone', 'Australia/Sydney', 'source', v_source, 'client', 'Chrome',
    'contributed', jsonb_build_object('recommendationsSeen', 128, 'activeSeconds', 3600, 'externalSaves', 2),
    'config', jsonb_build_object('recommendationLimitPerDay', 40, 'saveLimitPerDay', 5, 'timeLimitSecondsPerDay', 1800, 'youTubeBlocked', false)
  );
  v_result := public.sync_review_extension_day(v_user, v_payload);
  if v_result->'totals' <> '{"recommendationsSeen":128,"activeSeconds":3600,"saves":4}'::jsonb
     or v_result->'saves' <> jsonb_build_object('bbbbbbbbbbb',jsonb_build_object('source',v_source::text),'ccccccccccc',jsonb_build_object('source',v_source::text)) then
    raise exception 'Sydney local midnight, attribution, or account isolation failed: %', v_result;
  end if;
  v_payload := v_payload || jsonb_build_object(
    'source', v_second_source, 'client', 'Firefox',
    'contributed', jsonb_build_object('recommendationsSeen',82,'activeSeconds',1800,'externalSaves',0)
  );
  perform public.sync_review_extension_day(v_user, v_payload);
  v_result := public.sync_review_extension_day(v_user, v_payload);
  if v_result->'totals' <> '{"recommendationsSeen":210,"activeSeconds":5400,"saves":4}'::jsonb then
    raise exception 'Cross-browser absolute upsert/idempotency failed: %', v_result;
  end if;
  v_payload := v_payload || '{"date":"2026-09-08","contributed":{"recommendationsSeen":0,"activeSeconds":0,"externalSaves":0}}'::jsonb;
  v_result := public.sync_review_extension_day(v_user, v_payload);
  if v_result->'totals' <> '{"recommendationsSeen":0,"activeSeconds":0,"saves":1}'::jsonb
     or v_result->'saves' <> jsonb_build_object('ddddddddddd',jsonb_build_object('source',v_source::text)) then
    raise exception 'Next local day reused old totals: %', v_result;
  end if;
  v_payload := v_payload || '{"date":"2026-10-04"}'::jsonb;
  v_result := public.sync_review_extension_day(v_user, v_payload);
  if v_result#>>'{totals,saves}' <> '2'
     or v_result->'saves' <> jsonb_build_object('fffffffffff',jsonb_build_object('source',v_source::text),'ggggggggggg',jsonb_build_object('source',v_source::text)) then
    raise exception 'Sydney 23-hour DST day boundary failed: %', v_result;
  end if;
  v_result := public.sync_review_extension_day(v_user, v_payload || '{"timezone":"Australia/Brisbane"}'::jsonb);
  if v_result#>>'{totals,saves}' <> '3' or not (v_result->'saves' ? 'hhhhhhhhhhh') then
    raise exception 'Brisbane non-DST day failed: %', v_result;
  end if;
end;
$test$;
rollback;
