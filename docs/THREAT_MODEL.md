# Threat model

## Protected assets

- the raw shared invitation, invitation-gate cookies, website session tokens, CSRF tokens, and extension bearer tokens;
- Google access/refresh tokens and reviewer Google subject/email;
- subscription identities and saved-video metadata;
- the Supabase server secret (`sb_secret_…`, exposed by Supabase as `service_role`), OAuth client secret, token-encryption key, and session-signing key;
- strict separation from public `villow.app`, the real Villow application, and other reviewers.

## Trust boundaries and controls

### Public browser to review Worker

The shared invitation arrives only in a POST body after the browser reads it from a `review.villow.app` fragment. It never appears in a server URL, query string, log, or frontend bundle, and the fragment is removed immediately with `history.replaceState`. The Worker compares it with `REVIEW_INVITE_TOKEN` in constant time. Failed attempts use the database-backed rate limiter when available; a rate-limit storage outage cannot block a valid high-entropy invitation or turn an invalid invitation into a server error.

Successful validation sets a `Secure`, `HttpOnly`, `SameSite=Lax` browser-session gate cookie. Its signature is derived from the current invitation secret, so rotating `REVIEW_INVITE_TOKEN` invalidates both the old URL and existing gate cookies. The invitation is reusable, has no per-use database row or application expiry, and remains separate from website sessions and extension bearer tokens.

Website sessions use a signed opaque cookie plus a server-side hashed record. The session cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, expiring, and revocable. State-changing website requests require same-origin plus a per-session double-submit CSRF token whose hash is stored server-side.

### Google to review Worker

OAuth uses an exact same-origin callback, one-time hashed state, PKCE S256, a ten-minute transaction, and no caller-provided redirect. Requested scopes are fixed in source. Tokens are never returned to the browser or extension and are encrypted at rest with per-value AES-GCM nonces. Sensitive Google error payloads are neither stored nor returned.

### Extension to review Worker

CORS preflights require an exact packaged-extension origin from configuration, and responses echo only a matching supplied origin with `Vary: Origin`. Wildcards are not supported. Chrome may omit `Origin` from privileged extension service-worker requests after host permission is granted; those requests proceed directly to bearer authentication. A supplied but unlisted origin is always rejected. CORS and the forgeable or absent `Origin` header are not authentication: every extension route independently requires an active hashed bearer token owned by one reviewer. Production rejects unknown hosts and does not expose a `workers.dev` or preview URL.

### Worker to storage and external services

Only the Worker/operator service role can access review tables. RLS is enabled without browser policies. Ownership filters or owner-scoped RPC arguments are applied to every queue, token, subscription, session, and totals operation. OAuth completion, queue insert/duplicate result, daily upsert/totals read, and subscription replacement use database transactions.

The subscriptions route is the only runtime path that calls Google/YouTube. The queue path accepts validated extension metadata and performs no outbound metadata fetch, preventing SSRF and quota coupling.

## Input and browser hardening

- 16 KiB JSON request limit and exact content type
- allowlisted fields and bounded types/lengths
- control-character rejection and inert DOM rendering through `textContent`
- strict YouTube video ID, canonical source URL, thumbnail host/path, client, UUID, date, timezone, duration, and counter validation
- CSP, `frame-ancestors 'none'`, no-referrer, MIME sniffing protection, restrictive permissions policy, no-store caching, and no analytics/third-party scripts
- database-backed rate limits for failed invitation attempts and extension traffic
- no open redirects, arbitrary backend fetches, or sensitive logs

## Residual risks

- A compromised dedicated Google review account can expose only that account's harmless review subscriptions. Keep it free of personal data.
- An operator with the Supabase `sb_secret_…` key can access review rows. Limit and rotate the credential and use a dedicated project.
- The Worker cannot prevent a reviewer from sharing a raw connect link before it is revoked. Give links short expiries and revoke them after review.
- YouTube may not expose a handle for every channel. Stable channel ID and title remain available; the response includes every identity field the API supplies.
- Google OAuth Testing grants that request YouTube read access can expire after seven days. The explicit 503/reconnect path preserves subscription and queue behavior safely.
