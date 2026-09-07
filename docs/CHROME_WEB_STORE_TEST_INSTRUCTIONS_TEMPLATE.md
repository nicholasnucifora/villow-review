# Private Chrome Web Store test instructions

Replace every placeholder immediately before submission. Keep the completed version only in the Chrome Web Store's private reviewer-instructions field or another approved secret store. Do not commit the completed version.

---

## Villow extension review

This extension can be reviewed against the isolated environment at `https://review.villow.app`.

Private review invitation:

`{{INVITATION_URL}}`

Dedicated Google test account:

- Email: `{{REVIEW_GOOGLE_EMAIL}}`
- Password: `{{REVIEW_GOOGLE_PASSWORD}}`

This account contains no personal data and is used only for this review. It is prepared so sign-in can be completed without a second factor that the reviewer cannot supply.

### Setup

1. Open the complete private invitation link above.
2. Continue with Google and sign in using the dedicated account.
3. Approve the requested YouTube read-only access.
4. On the review page, find **Connect Extension**, select **Generate connect link**, then **Copy**.
5. Open the Villow extension options, paste the complete connect link, and select **Test connection**.
6. Select **Refresh subscriptions**.

Known harmless public subscriptions on this account:

`{{KNOWN_SUBSCRIBED_CHANNELS}}`

Enable **Hide channels you are subscribed to**, open the YouTube home feed, and confirm tiles from one of the channels above are hidden. Then choose a video from an unsubscribed channel and confirm it appears in the private queue at `https://review.villow.app`.

If the extension says “Reconnect Google in Villow to refresh your subscriptions,” return to the review page, select **Reconnect Google**, sign in with the same dedicated account, and then refresh subscriptions in the extension. Queue saving remains available while Google authorization is stale.

The site is intentionally limited to Google connection status, extension connect-link management, and the reviewer's saved-video queue. It is not the full Villow application.

---

Operator check before submission: confirm all four required placeholders—`{{INVITATION_URL}}`, `{{REVIEW_GOOGLE_EMAIL}}`, `{{REVIEW_GOOGLE_PASSWORD}}`, and `{{KNOWN_SUBSCRIBED_CHANNELS}}`—have been replaced in the private submitted copy.
