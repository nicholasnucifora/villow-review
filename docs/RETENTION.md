# Review data retention and deletion

Review data is temporary. The operator should use this default schedule unless a shorter project policy applies:

- OAuth transaction rows: delete after 24 hours; they expire after 10 minutes and cannot be reused.
- Rate-limit buckets: the database function deletes buckets older than two days opportunistically.
- Active website sessions: 12 hours maximum; revoke immediately when review access ends.
- Extension connect links: 30 days maximum by default; revoke immediately when review access ends or a link is exposed.
- Invitations: 14 days by operator default; revoke after claim or when review access ends.
- Queue, subscription cache, sync history, Google identity, and encrypted Google tokens: delete within seven days after the store review finishes or is withdrawn.

## Reviewer self-service deletion

The signed-in reviewer can select **Forget this review**, type `FORGET`, and permanently delete the review user. Foreign-key cascades remove sessions, connect links, subscriptions, syncs, queue rows, and daily totals. The claimed invitation is revoked before deletion so it cannot be reused.

## Operator deletion

Inspect status without recovering raw secrets:

```sh
npm run admin -- user:status --user-id <review-user-uuid>
```

Delete the complete reviewer record:

```sh
npm run admin -- user:delete --user-id <review-user-uuid> --confirm-user-id <review-user-uuid>
```

After deletion, revoke the Villow review application's Google grant from the dedicated Google Account, then remove the account from the Google OAuth test-user list if Testing mode is used. Delete Chrome Web Store instructions containing expired invitation/connect links when the review process allows it.

Supabase backups may retain encrypted/hashed rows according to the dedicated review project's backup policy. Configure the shortest operationally acceptable backup retention and record it in the private deployment inventory.
