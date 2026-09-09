-- Run only against a disposable database with the review migrations applied.
-- Fixtures are rolled back, and assertions execute the real aggregation function.
\set ON_ERROR_STOP on
begin;
-- Fixed expected wire values; do not query production tables in this helper.
create function pg_temp.expected_review_save(p_source uuid, p_saved_at timestamptz, p_played boolean default false)
returns jsonb language sql as $expected$
  select jsonb_build_object(
    'source', p_source::text, 'savedAt', p_saved_at, 'present', true, 'played', p_played,
    'title', 'Desktop <video> & café', 'channel', 'Desktop channel'
  );
$expected$;
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
  v_chrome_saves jsonb;
  v_row jsonb;
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
  select v_user, v_token, id, 'Desktop <video> & café', 'Desktop channel', '', '', '', false, '', '', '', v_source, 'Chrome', 1, saved_at
  from (values
    ('aaaaaaaaaaa', timestamptz '2026-09-06 13:59:59+00'),
    ('bbbbbbbbbbb', timestamptz '2026-09-06 14:00:00.123456+00'),
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
  update public.review_queue_videos set played_at = '2026-09-07 13:59:59.5+00'
   where user_id = v_user and youtube_video_id = 'ccccccccccc';
  v_payload := jsonb_build_object(
    'date', '2026-09-07', 'timezone', 'Australia/Sydney', 'source', v_source, 'client', 'Chrome',
    'contributed', jsonb_build_object('recommendationsSeen', 128, 'activeSeconds', 3600, 'externalSaves', 2),
    'config', jsonb_build_object('recommendationLimitPerDay', 40, 'saveLimitPerDay', 5, 'timeLimitSecondsPerDay', 1800, 'youTubeBlocked', false)
  );
  v_result := public.sync_review_extension_day(v_user, v_payload);
  if v_result->'totals' <> '{"recommendationsSeen":128,"activeSeconds":3600,"saves":4}'::jsonb
     or v_result->'saves' <> jsonb_build_object('bbbbbbbbbbb',pg_temp.expected_review_save(v_source, '2026-09-06 14:00:00.123456+00'),'ccccccccccc',pg_temp.expected_review_save(v_source, '2026-09-07 13:59:59+00', true)) then
    raise exception 'Sydney local midnight, attribution, or account isolation failed: %', v_result;
  end if;
  v_chrome_saves := v_result->'saves';
  for v_row in select value from jsonb_each(v_chrome_saves) loop
    if jsonb_typeof(v_row->'savedAt') is distinct from 'string'
       or jsonb_typeof(v_row->'present') is distinct from 'boolean'
       or jsonb_typeof(v_row->'played') is distinct from 'boolean'
       or v_row->>'savedAt' !~ '^2026-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' then
      raise exception 'Invalid save detail wire types: %', v_row;
    end if;
  end loop;
  if public.get_review_queue_status(v_user)#>'{videos,ccccccccccc}' is distinct from '{"present":true,"played":true}'::jsonb then
    raise exception 'Daily map and queue status disagree about played state';
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
  if v_result->'saves' is distinct from v_chrome_saves then
    raise exception 'Firefox did not receive the same Chrome receipt details: %', v_result;
  end if;
  -- Keep the existing hard-delete behavior: removed rows vanish from map and totals.
  delete from public.review_queue_videos where user_id = v_user and youtube_video_id = 'bbbbbbbbbbb';
  v_result := public.sync_review_extension_day(v_user, v_payload);
  if v_result#>>'{totals,saves}' is distinct from '3'
     or v_result->'saves' is distinct from jsonb_build_object('ccccccccccc', pg_temp.expected_review_save(v_source, '2026-09-07 13:59:59+00', true)) then
    raise exception 'Deleted unplayed receipt remained in daily snapshot: %', v_result;
  end if;
  v_payload := v_payload || '{"date":"2026-09-08","contributed":{"recommendationsSeen":0,"activeSeconds":0,"externalSaves":0}}'::jsonb;
  v_result := public.sync_review_extension_day(v_user, v_payload);
  if v_result->'totals' <> '{"recommendationsSeen":0,"activeSeconds":0,"saves":1}'::jsonb
     or v_result->'saves' <> jsonb_build_object('ddddddddddd',pg_temp.expected_review_save(v_source, '2026-09-07 14:00:00+00')) then
    raise exception 'Next local day reused old totals: %', v_result;
  end if;
  v_payload := v_payload || '{"date":"2026-10-04"}'::jsonb;
  v_result := public.sync_review_extension_day(v_user, v_payload);
  if v_result#>>'{totals,saves}' <> '2'
     or v_result->'saves' <> jsonb_build_object('fffffffffff',pg_temp.expected_review_save(v_source, '2026-10-03 14:00:00+00'),'ggggggggggg',pg_temp.expected_review_save(v_source, '2026-10-04 12:59:59+00')) then
    raise exception 'Sydney 23-hour DST day boundary failed: %', v_result;
  end if;
  v_result := public.sync_review_extension_day(v_user, v_payload || '{"timezone":"Australia/Brisbane"}'::jsonb);
  if v_result#>>'{totals,saves}' <> '3' or not (v_result->'saves' ? 'hhhhhhhhhhh') then
    raise exception 'Brisbane non-DST day failed: %', v_result;
  end if;
  v_result := public.sync_review_extension_day(v_user, v_payload || '{"date":"2026-09-10"}'::jsonb);
  if v_result->'saves' is distinct from '{}'::jsonb or v_result#>>'{totals,saves}' is distinct from '0' then
    raise exception 'Empty day did not return an empty saves object: %', v_result;
  end if;
  if has_function_privilege('anon', 'public.sync_review_extension_day(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.sync_review_extension_day(uuid,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.sync_review_extension_day(uuid,jsonb)', 'EXECUTE') then
    raise exception 'Save metadata migration changed the service-role execution boundary';
  end if;
end;
$test$;
rollback;
