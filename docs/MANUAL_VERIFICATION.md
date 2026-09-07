# Manual end-to-end verification

Use two isolated browser profiles and two dedicated test Google accounts for cross-user checks. Never use a personal account.

1. Confirm the long-lived shared `REVIEW_INVITE_TOKEN` is set on the Worker.
2. Open the complete `https://review.villow.app/#villow_invite=<secret>` URL and confirm the fragment is cleared automatically without a paste step. Separately verify that the paste box remains available at the bare origin.
3. Sign into an allowlisted test account and grant `youtube.readonly`.
4. Confirm the site shows subscription access connected and a successful refresh timestamp.
5. Under **Connect Extension**, generate and copy an extension connect link.
6. Connect the packaged extension and run **Test connection**.
7. Run **Refresh subscriptions** and enable **Hide channels you are subscribed to**.
8. Confirm at least one seeded channel matches by handle/title on a home-feed tile.
9. Save an eligible video from an unsubscribed channel.
10. Confirm the extension receives a success and the video appears newest-first in the review queue.
11. Submit the same video again and confirm duplicate `409` is treated as success.
12. Pair a second reviewer and confirm neither reviewer can read, remove, or query the other's queue/subscriptions.
13. Revoke or expire the first reviewer's Google grant.
14. Confirm `GET /api/subscriptions` returns `503` with exactly `{"message":"Reconnect Google in Villow to refresh your subscriptions."}` and the previous subscription cache remains.
15. While Google remains stale, save another video and confirm it reaches the queue. Inspect Google/YouTube request logs to confirm the save generated no API call.
16. Reconnect Google and confirm subscription refresh recovers without rotating the extension token.
17. Check `POST /api/extension-day` totals after a queue receipt and confirm the new save is included synchronously.
18. Check `GET /api/queue/status` and confirm every returned entry contains boolean `played` and `present`.
19. Remove an unplayed video and confirm it disappears. A repeated delete may return `404`, which the extension treats as success.
20. Revoke the extension token and confirm `GET /api/ping` and queue save return `401`; confirm a Google failure never returns `401`.
21. Test an unlisted extension origin and confirm preflight/requests are rejected without a wildcard CORS header and all responses contain `Vary: Origin`.
22. Confirm `https://villow.app`, its index, and its policy files are unchanged and no review credentials/bindings exist in that deployment.
23. Revoke the connect link and delete review data after the test. Rotate the shared invitation only when it must be revoked, not after each use.
