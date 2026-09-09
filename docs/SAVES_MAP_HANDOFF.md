# Save-map follow-up for the extension agent

I inspected the actual repository implementation and §5.1 of your updated contract. The previous sync_review_extension_day function returned **only source** per entry. savedAt, present, played, title, and channel were all missing; they were not merely undocumented.

I added the five missing fields in migration 202609090005_extension_day_save_details.sql. Each saves[videoId] now has:

```json
{
  "source": "33333333-3333-4333-8333-333333333333",
  "savedAt": "2026-09-07T05:42:00+00:00",
  "present": true,
  "played": false,
  "title": "A harmless test video",
  "channel": "Example Channel"
}
```

source retains the saving installation's UUID. savedAt comes directly from the stored saved_at timestamp and is serialized as an ISO 8601 string with an offset, retaining the original save instant. title and channel come from title and channel_name. present is the boolean true for each existing queue row, and played is the boolean result of played_at IS NOT NULL, matching GET /api/queue/status. These fields are read within the existing database function, with the same account/date/timezone filters.

The change adds fields to existing entries. It does not change counters, date selection, origin handling, authentication, queue writes/deletes, or Chrome transport. The Worker already passes the database snapshot through and adds date, so this change requires no Worker code changes.

**Rollout:** the migration is prepared and tested locally, but has not been applied to the live review database. Apply migration 005 to the dedicated review Supabase project after migrations 001–004. Rebuilding or deploying the Worker alone will not add these fields. Existing queue rows immediately supply their stored metadata after the migration; no resave or backfill is needed.

**Existing playback/deletion limitations:** the review page currently opens YouTube externally and has no playback-recording path that sets played_at. This change exposes the stored state accurately; it does not introduce playback detection. Queue deletion still physically removes the row, so it then disappears from both the map and queue-row totals. This patch adds neither deletion tombstones nor a new rule for retaining spent slots.

Validation: 110 automated Worker tests and TypeScript checking passed. The SQL regression fails against the old source-only function and passes after migration 005. In an isolated PostgreSQL 17 cluster, I verified all six fields, unchanged Chrome receipts when another Firefox source syncs, both played states, real timestamps including fractional seconds, local midnight and DST, deletion, empty days, account isolation, and preserved execution permissions. Checks passed with UTC and a non-UTC database timezone; applying the replacement migration twice was also tested. The temporary cluster was stopped.

After the migration is applied, run your acceptance check with desktop Chrome and Firefox for Android on the same account and local day: the phone should receive the desktop receipt's full metadata and timestamp without any phone-local record. Verify visibility, descending time order, the local “Added …” tooltip, title, and channel. The real mobile-browser acceptance test has not been run here.
