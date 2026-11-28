Review written to `.planr/reviews/PLAN-review-note-sharing.md`. Verdict: revise. Blocking: no revoke task,
no ownership check on link creation, guessable `Math.random` tokens, a read route that still demands
`x-user-id`, a response that leaks `ownerId`, and links that show the live note instead of a snapshot.
Major: 7-day expiry against the spec's 30, no migration for the new `shares` data, and an oversized task 6.
