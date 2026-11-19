---
id: PLAN-001
spec: docs/specs/note-sharing.md
---
# PLAN-001: Note sharing by link

## US-001 Share links

- **T-001 Link store.** `src/shares.js` with `create`, `find` and `revoke`, records `createdAt`.
  Files: `src/shares.js`, `test/shares.test.js`. Verify: unit tests. Covers R1.
- **T-002 Create a link.** `POST /notes/:id/shares`, owner only (`requireOwner`), returns `{ token }`.
  Files: `src/server.js`, `test/shares-api.test.js`. Verify: API test, non-owner gets 404. Depends on T-001. Covers R1.
- **T-003 Read through a link.** `GET /shared/:token` returns title, body and due, no `x-user-id` needed.
  Files: `src/server.js`, `test/shares-api.test.js`. Verify: API test. Depends on T-001. Covers R2.
- **T-004 Read-only.** Only `GET` accepts a token; `PATCH` and `DELETE` with a token are rejected.
  Files: `src/server.js`, `test/shares-api.test.js`. Verify: API test for both verbs. Covers R3.
- **T-005 Revoke.** `DELETE /notes/:id/shares/:token`, owner only; revoked tokens return 404.
  Files: `src/server.js`, `src/shares.js`, `test/shares-api.test.js`. Verify: API test. Depends on T-001. Covers R4.
- **T-006 Expiry.** Tokens older than 30 days return 410.
  Files: `src/shares.js`, `src/server.js`, `test/shares.test.js`. Verify: unit test with a fixed clock. Depends on T-001. Covers R5.
