# Deployment and configuration

## Isolation checklist

Create all of the following specifically for the review environment:

- a Supabase project that contains review data only;
- a Google Cloud project and Web application OAuth client used only by `review.villow.app`;
- a Cloudflare Worker named `villow-review` with the `review.villow.app` Custom Domain;
- separate production, staging, and development secrets.

Do not reuse personal or production Villow projects, Google refresh tokens, Supabase tables, service-role keys, sessions, or Worker bindings. The root `villow.app` static site is not part of this deployment.

## Supabase

Use these project settings:

- **Enable Data API:** on. The Worker calls the project's `/rest/v1` Data API.
- **Automatically expose new tables/functions:** off. Migration 003 grants only the direct table operations the Worker and operator CLI need.
- **Automatically enable RLS:** on. The migrations also enable RLS explicitly, so rerunning that protection is safe.
- **Exposed schema:** `public`.

In the Supabase dashboard, open **SQL Editor**, select **New query**, and run these files one at a time in filename order:

1. `supabase/migrations/202609070001_review_environment.sql`
2. `supabase/migrations/202609070002_operator_functions.sql`
3. `supabase/migrations/202609070003_data_api_permissions.sql`
4. `supabase/migrations/202609070004_shared_invitation_gate.sql`
5. `supabase/migrations/202609090005_extension_day_save_details.sql`

For an existing instance, apply only migrations it has not already received. Migration 005 adds the five missing save-map fields using existing queue columns; it replaces one function without changing tables or counters. Existing rows need no backfill. The Worker already forwards this map, so deploying the Worker alone does not activate the save-map change.

Wait for a successful result after each file before running the next. The migrations enable RLS on every review table, create no anon/authenticated-browser policy, restrict function execution, and explicitly grant the server-side `service_role` only the Data API operations it needs.

Copy the dedicated project's URL from the dashboard's **Connect** dialog (or **Integrations → Data API**) and use it as `REVIEW_SUPABASE_URL`. Find the dedicated key under **Settings → API Keys** and use the value beginning `sb_secret_` as `REVIEW_SUPABASE_SERVICE_ROLE_KEY`. The environment-variable name is retained for compatibility even though new Supabase projects call this a **secret key**. Do not paste either value into SQL.

Keep the project URL and `sb_secret_` key out of Git and frontend code. The key is a Worker/operator secret, never a browser value. Modern `sb_secret_` keys are sent only through Supabase's `apikey` header; the Worker retains compatibility with legacy service-role JWTs without treating a modern secret key as a bearer JWT.

Supabase references: [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [securing the Data API](https://supabase.com/docs/guides/api/securing-your-api), [explicit grants when automatic exposure is disabled](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

## Google Cloud OAuth

In the dedicated review Google Cloud project:

1. Enable YouTube Data API v3.
2. In **Google Auth Platform → Branding**, complete the app name, support email, and developer contact fields.
3. In **Google Auth Platform → Data Access**, choose **Add or remove scopes** and retain only `openid`, `https://www.googleapis.com/auth/userinfo.email`, and `https://www.googleapis.com/auth/youtube.readonly`. If the console already includes the two basic sign-in scopes, add only the YouTube read-only scope. Do not add any YouTube write, upload, account-management, Drive, Gmail, or profile scope.
4. In **Google Auth Platform → Clients**, choose **Create client**, select **Web application**, and name it `Villow review`.
5. Leave **Authorized JavaScript origins** empty. Add the exact **Authorized redirect URI** `https://review.villow.app/api/oauth/callback`.
6. Create the client and privately save its client ID and client secret for the Worker secrets `REVIEW_GOOGLE_CLIENT_ID` and `REVIEW_GOOGLE_CLIENT_SECRET`. Never put the client secret in source or frontend assets.
7. In **Google Auth Platform → Audience**, keep the app External. If publishing status is Testing, add the operator account and dedicated Chrome reviewer account under **Test users**.

The Worker uses the server-side authorization-code flow, random state, PKCE S256, `access_type=offline`, and `prompt=consent select_account`. Google tokens are encrypted with AES-256-GCM before storage. The encryption key exists only as a Worker secret.

### Testing and In Production both work

Publishing status is not hard-coded. The same Worker operates with either Google OAuth status:

- **Testing:** add each tester, including the dedicated Chrome reviewer account, to the OAuth test-user list. Because YouTube read access is requested, authorizations and refresh tokens can expire seven days after consent. Reauthorize the dedicated account close to the Chrome Web Store submission and again if review is delayed.
- **In Production:** the test-user allowlist and seven-day Testing authorization expiry no longer apply. Changing the publishing status does **not** verify the application. An unverified app requesting a sensitive scope may still show Google's unverified-app warning and can remain subject to the 100-new-user cap.

Choose publishing status as an operator decision. Do not promise reviewers that In Production removes a warning; only completed Google verification establishes verified status.

Google references: [web-server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server), [publishing status and Testing expiry](https://support.google.com/cloud/answer/15549945), [unverified apps](https://support.google.com/cloud/answer/7454865).

## Cloudflare secrets

Generate encryption/signing material locally:

```sh
npm run admin -- keys:generate
```

Set every required secret declared in the production `wrangler.jsonc`. When Wrangler prompts for a value, paste the value privately and press Enter; do not put it on the command line:

```sh
npx wrangler secret put REVIEW_SUPABASE_URL --config wrangler.jsonc
npx wrangler secret put REVIEW_SUPABASE_SERVICE_ROLE_KEY --config wrangler.jsonc
npx wrangler secret put REVIEW_GOOGLE_CLIENT_ID --config wrangler.jsonc
npx wrangler secret put REVIEW_GOOGLE_CLIENT_SECRET --config wrangler.jsonc
npx wrangler secret put REVIEW_TOKEN_ENCRYPTION_KEY --config wrangler.jsonc
npx wrangler secret put REVIEW_SESSION_SIGNING_KEY --config wrangler.jsonc
npx wrangler secret put REVIEW_INVITE_TOKEN --config wrangler.jsonc
```

For `REVIEW_SUPABASE_SERVICE_ROLE_KEY`, paste the dedicated `sb_secret_…` value. For `REVIEW_SUPABASE_URL`, paste the `https://<project-ref>.supabase.co` project URL. Use a high-entropy `REVIEW_INVITE_TOKEN` that will remain stable for at least six months; rotate it only to revoke the shared invitation.

Cloudflare Worker secrets are scoped to a Worker (and, when used, its Wrangler environment). Secrets attached to the `villow-site` Worker are not shared with `villow-review`: they do not satisfy `villow-review` bindings, and duplicate names on `villow-site` do not conflict with this Worker. Add all seven required secrets to `villow-review`; remove copies from `villow-site` only if that site's own code does not use them.

In the dashboard, add them under **Workers & Pages → villow-review → Settings → Variables and Secrets**, choose type **Secret** for every name, and select **Deploy** to apply the changes. Do not put them under **Settings → Build → Build Variables and Secrets** as a substitute: build secrets exist only while the Git build is running and are not runtime bindings for the deployed Worker.

`workers_dev` and preview URLs are disabled in `wrangler.jsonc`, and the Worker additionally rejects hosts other than `REVIEW_ORIGIN` in production. The Custom Domain is exact; API requests are never redirected to another host.

## Extension origins

No extension ID or Firefox installation UUID needs to be configured. Extension
API requests use bearer authentication, and CORS echoes the supplied Origin.
Originless Chrome service-worker requests continue to work. CORS does not enable
cookie credentials or relax the website session/CSRF checks.

ALLOWED_EXTENSION_ORIGINS is no longer read or required in any environment.
An existing Worker secret with that name is harmless and may be removed separately.
Deploying the Worker activates both the Firefox fix and the extension-day response
date. The existing database function already buckets by the supplied local date
and timezone; no database migration is needed for those two earlier fixes.
The subsequent save-map metadata addition requires migration 005, listed above.

## Build and deploy

From this directory:

```sh
npm run typecheck
npm test
npm run build
npm run deploy
```

For a Cloudflare Git deployment, open the **villow-review** Worker (not `villow-site`) and configure the exact commands **Build command** `npm run build` and **Deploy command** `npm run deploy`. The production file is the default `wrangler.jsonc`, so even Cloudflare's generic `npx wrangler deploy` command resolves to the same isolated production Worker. The deploy script also fails closed if Workers Builds supplies a `WRANGLER_CI_OVERRIDE_NAME` other than `villow-review`.

Local development uses `wrangler.dev.jsonc`; staging uses `wrangler.staging.jsonc`; production uses the default `wrangler.jsonc`. Each has its own origin and Worker identity. Use `npm run deploy:staging` only for staging. Change the staging hostname before first staging deployment if `review-staging.villow.app` is not the chosen private staging domain, and register a matching staging Google OAuth redirect URI. Never point development or staging at the production Supabase or Google project.

Confirm the deployed Worker is attached directly to `review.villow.app`, its `workers.dev` route and preview URLs are disabled, all required secrets resolve, and no binding from the main Villow site or application is present.
