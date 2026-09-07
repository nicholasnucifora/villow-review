# Threat model

## Protected assets

- raw invitations, website session tokens, CSRF tokens, and extension bearer tokens;
- Google access/refresh tokens and reviewer Google subject/email;
- subscription identities and saved-video metadata;
- the Supabase server secret (`sb_secret_…`, exposed by Supabase as `service_role`), OAuth client secret, token-encryption key, and session-signing key;
- strict separation from public `villow.app`, the real Villow application, and other reviewers.

## Trust boundaries and controls

### Public browser to review Worker

Invitation tokens arrive only in a POST body after the browser validates a `review.villow.app` fragment link. They never appear in server URL query strings. Validation is generic, database-backed, rate-limited, expiry-aware, and does not reveal other accounts. Invitations are high entropy, hashed, revocable, and bound atomically to the first Google subject.

Website sessions use a signed opaque cookie plus a server-side hashed record. The session cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, expiring, and revocable. State-changing website requests require same-origin plus a per-session double-submit CSRF token whose hash is stored server-side.

### Google to review Worker

OAuth uses an exact same-origin callback, one-time hashed state, PKCE S256, a ten-minute transaction, and no caller-provided redirect. Requested scopes are fixed in source. Tokens are never returned to the browser or extension and are encrypted at rest with per-value AES-GCM nonces. Sensitive Google error payloads are neither stored nor returned.

### Extension to review Worker

CORS compares exact packaged-extension origins from configuration and echoes only a matching origin with `Vary: Origin`. Wildcards are not supported. CORS is not authentication: every extension route independently requires an active hashed bearer token owned by one reviewer. Production rejects unknown hosts and does not expose a `workers.dev` or preview URL.

### Worker to storage and external services

Only the Worker/operator service role can access review tables. RLS is enabled without browser policies. Ownership filters or owner-scoped RPC arguments are applied to every queue, token, subscription, session, and totals operation. The complete OAuth claim, queue insert/duplicate result, daily upsert/totals read, subscription replacement, and safe invitation unbind use database transactions.

The subscriptions route is the only runtime path that calls Google/YouTube. The queue path accepts validated extension metadata and performs no outbound metadata fetch, preventing SSRF and quota coupling.

## Input and browser hardening

- 16 KiB JSON request limit and exact content type
- allowlisted fields and bounded types/lengths
- control-character rejection and inert DOM rendering through `textContent`
- strict YouTube video ID, canonical source URL, thumbnail host/path, client, UUID, date, timezone, duration, and counter validation
- CSP, `frame-ancestors 'none'`, no-referrer, MIME sniffing protection, restrictive permissions policy, no-store caching, and no analytics/third-party scripts
- database-backed rate limits for invitation and extension traffic
- no open redirects, arbitrary backend fetches, or sensitive logs

## Residual risks

- A compromised dedicated Google review account can expose only that account's harmless review subscriptions. Keep it free of personal data.
- An operator with the Supabase `sb_secret_…` key can access review rows. Limit and rotate the credential and use a dedicated project.
- The Worker cannot prevent a reviewer from sharing a raw connect link before it is revoked. Give links short expiries and revoke them after review.
- YouTube may not expose a handle for every channel. Stable channel ID and title remain available; the response includes every identity field the API supplies.
- Google OAuth Testing grants that request YouTube read access can expire after seven days. The explicit 503/reconnect path preserves subscription and queue behavior safely.
