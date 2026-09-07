# Villow extension review environment

This directory is the isolated `review.villow.app` application. It is a standalone Cloudflare Worker with its own configuration, secrets, Google Cloud project, and review-only Supabase project.

It intentionally does not contain or import the public `villow.app` site or the full self-hosted Villow application.

## What is implemented

- Private fragment-based invitation onboarding with first-Google-account binding
- Server-side Google OAuth authorization-code flow with state, PKCE, exact callback URI, and offline access
- AES-256-GCM encryption for Google access and refresh tokens
- Hashed invitation, website-session, CSRF, and extension-connect credentials
- Revocable, server-side website sessions in `Secure`, `HttpOnly`, `SameSite=Lax` cookies
- Exact extension bearer API for ping, queue saving, subscriptions, shared daily totals, queue status, and removal
- Live paginated YouTube subscription refresh, with channel ID, handle when available, and title
- Last-known-good subscription persistence on every refresh failure
- Queue saving that has no Google, YouTube Data API, oEmbed, scraping, or metadata-enrichment dependency
- Exact, configurable extension-origin allowlist with `Vary: Origin`
- Reviewer-only queue UI and local operator CLI; there is no public admin surface
- Append-only review schema migrations, security headers, size limits, validation, and database-backed rate limits

## Local checks

```sh
npm install
copy .dev.vars.example .dev.vars
npm run typecheck
npm test
npm run build
```

Do not use real production or personal credentials in `.dev.vars`. Use a separate local/staging review project.
The default `wrangler.jsonc` is production-only and targets the isolated `villow-review` Worker. Deploy production with `npm run deploy`; the command refuses any Cloudflare CI target-name override other than `villow-review`. Local development and staging always use their explicitly named configuration files.

## Documentation

- [Deployment and configuration](docs/DEPLOYMENT.md)
- [Operator runbook](docs/OPERATOR_RUNBOOK.md)
- [Chrome Web Store test-instructions template](docs/CHROME_WEB_STORE_TEST_INSTRUCTIONS_TEMPLATE.md)
- [Contract compatibility](docs/CONTRACT_COMPATIBILITY.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Retention and deletion](docs/RETENTION.md)
- [Manual end-to-end verification](docs/MANUAL_VERIFICATION.md)

The authoritative client wire contract remains the extension agent's `REVIEW_BACKEND_CONTRACT.md` for Villow extension v0.8.2. The addendum's stricter Google-reauthorization body takes precedence where noted in the compatibility document.
