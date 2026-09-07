# Operator runbook

Run every command from `review/` in a trusted local shell. Set `REVIEW_SUPABASE_URL` to the dedicated project URL and `REVIEW_SUPABASE_SERVICE_ROLE_KEY` to its dedicated `sb_secret_…` key; optionally set `REVIEW_ORIGIN` (it defaults to `https://review.villow.app`). The variable keeps its legacy name for compatibility. Never paste this credential into a browser or commit it.

## Create a private invitation

```sh
npm run admin -- invite:create --label "Chrome Web Store reviewer" --expires-days 14
```

The command stores only a SHA-256 hash and prints the raw fragment invitation once. Copy the printed URL into the private Chrome Web Store test instructions. The invitation binds to the first Google account that completes OAuth and can later be resumed only by that account.

Create one invitation per human tester. Do not share one invitation among testers.

## Prepare the dedicated Google review account

1. Create a non-personal Google account used only for Chrome Web Store review.
2. Do not add personal mail, files, contacts, photos, payments, browser history, or other private data.
3. Make sure a reviewer can sign in with the supplied credentials without a second factor or recovery step they cannot complete.
4. If the OAuth project is in Testing, add this exact account as a test user.
5. Subscribe it to a small, harmless set of public YouTube channels whose IDs, handles, and titles can be recognized in the home feed.
6. Open the invitation, sign in as this account, grant the requested YouTube read-only access, and confirm the review page reports a successful subscription refresh.

Store the account email and password only in the Chrome Web Store's private test-instructions field or an approved password manager. They do not belong in Git, issue trackers, logs, or application configuration.

## Confirm known subscribed channels

After authorization, press **Refresh subscriptions** in the extension, then verify at least two seeded channels:

- record the exact visible channel title;
- record the public handle, including `@` in the reviewer instructions;
- optionally record the stable `UC…` channel ID for operator diagnosis;
- confirm a YouTube home-feed tile from each channel is hidden when “Hide channels you are subscribed to” is enabled.

Put only the harmless channel title/handle list into `{{KNOWN_SUBSCRIBED_CHANNELS}}` when preparing the private reviewer instructions. The Worker returns `channelId`, `handle` when YouTube provides one, and `title`; this makes all extension match paths testable.

## Generate the extension connect link

Preferred reviewer flow: while signed in to `review.villow.app`, select **Generate connect link**, then **Copy**. The raw bearer token appears only once.

Operator recovery flow:

```sh
npm run admin -- token:create --user-id <review-user-uuid> --label "Chrome Web Store review" --expires-days 30
```

Place the result into `{{CONNECT_LINK}}` if the private reviewer instructions include a pre-generated connection. Do not commit it. A connect token is independent from the invitation and website session.

## Reauthorize Google

If the extension shows “Reconnect Google in Villow to refresh your subscriptions.”:

1. Sign in to `review.villow.app` using the existing invitation/session and the same dedicated Google account.
2. Select **Reconnect Google**.
3. Complete consent with the same account.
4. Return to the extension and press **Refresh subscriptions**.

Reauthorization replaces encrypted Google authorization data but does not rotate the extension link and does not clear the last-known-good subscription cache. Queue saving continues before, during, and after this process.

In Google OAuth Testing mode, do this close to store submission because YouTube-authorized refresh tokens can expire after seven days.

## Inspect status without recovering secrets

```sh
npm run admin -- user:status --user-id <review-user-uuid>
```

The status output contains identifiers, safe timestamps, counts, and safe subscription error categories. It never returns invitation, session, extension, or Google tokens.

## Revoke access

Revoke an invitation:

```sh
npm run admin -- invite:revoke --id <invitation-uuid>
```

Revoke an extension connect link:

```sh
npm run admin -- token:revoke --id <extension-token-uuid>
```

Revoke all website sessions for a reviewer:

```sh
npm run admin -- session:revoke --user-id <review-user-uuid>
```

Safely unbind an invitation only when account binding was incorrect. This also revokes that user's sessions and extension links:

```sh
npm run admin -- invite:unbind --id <invitation-uuid> --confirm-user-id <review-user-uuid>
```

Clear only the queue:

```sh
npm run admin -- queue:clear --user-id <review-user-uuid>
```

Delete all reviewer data and revoke the claimed invitation:

```sh
npm run admin -- user:delete --user-id <review-user-uuid> --confirm-user-id <review-user-uuid>
```

Revoking a Google grant in the Google Account is separate. Do it when the review is complete, then delete the review data according to the retention procedure.
