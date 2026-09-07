# Extension contract compatibility

Target client: Villow browser extension v0.8.2, using the authoritative `REVIEW_BACKEND_CONTRACT.md` supplied by the extension agent.

| Route | Status | Behavior |
|---|---|---|
| `OPTIONS *` | Implemented | Exact configurable extension origin; authorization/content-type headers; GET/POST/DELETE/OPTIONS; `Retry-After` exposed |
| `GET /api/ping` | Implemented | Bearer required; `200 {}` |
| `POST /api/queue` | Implemented | Validated extension metadata only; synchronous Supabase write; `201` or duplicate `409`; never calls Google |
| `GET /api/subscriptions` | Implemented | Complete live/cached list with stable `channelId`, `handle` when available, and `title` |
| `POST /api/extension-day` | Implemented | Absolute per-browser upsert; account totals; queue rows and external saves counted without double counting |
| `GET /api/queue/status` | Implemented | Valid `{"videos":{…}}` with both required booleans |
| `DELETE /api/queue/:videoId` | Implemented | Cross-user isolated delete; `404` when absent |
| `GET /api/extension-settings` | Intentionally `404` | Extension uses its documented optional-route fallback |
| `POST /api/extension-usage` | Intentionally `404` | Extension marks unsupported and falls back |
| `POST /api/screen-time` | Intentionally `404` | Obsolete optional route |

Unsupported routes never return a misleading `200 {}`.

## Addendum precedence

For an expired, revoked, missing, or unusable Google/YouTube grant, `GET /api/subscriptions` returns HTTP `503` with this body and no additional fields:

```json
{
  "message": "Reconnect Google in Villow to refresh your subscriptions."
}
```

This is the single intentional wire-detail override to the earlier contract example, which also showed an `error` field. The handoff addendum requires exact compatibility with the body above. HTTP `401` remains reserved for an invalid or revoked Villow extension bearer token.

Subscription replacement is atomic and occurs only after every YouTube page and channel-metadata batch succeeds. A failure records only a safe category and leaves the last-known-good rows untouched. The extension therefore keeps its own cache as required, and the server never converts an authorization failure into a successful empty list.

## Subscription refresh semantics

The extension has no separate refresh endpoint, so `GET /api/subscriptions` performs the server refresh. The Worker uses a successful-result cache of at most 60 seconds, prevents overlapping refresh work per reviewer, paginates `subscriptions.list`, and enriches channel identity with `channels.list` so handles are supplied when YouTube exposes them.

## Queue isolation from Google

The queue branch invokes no Google function and calls only validation, bearer authentication, rate limiting, and the synchronous `save_review_queue_video` database function. It constructs canonical watch URLs in the UI from the validated 11-character video ID. The submitted `sourceUrl` and thumbnail are validated but never fetched.

Queue saves therefore consume zero YouTube Data API quota and continue when the user's Google access/refresh tokens are expired, revoked, missing, or temporarily unusable.
