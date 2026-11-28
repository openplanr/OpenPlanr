---
id: PLAN-001
spec: docs/specs/note-sharing.md
---
# PLAN-001: Note sharing

- **T-001 Revoke links.** `DELETE /notes/:id/shares/:token`. Files: `src/server.js`. Verify: API test.
- **T-002 Link store and create route.** `src/shares.js`, `POST /notes/:id/shares`. Files: `src/shares.js`, `src/server.js`. Verify: unit and API tests. Depends on nothing.
- **T-003 Email the recipient.** Send an email with the link when it is created. Files: `src/mailer.js`. Verify: mailer test.
- **T-004 Invite teammates by name.** Share with named users. Files: `src/server.js`. Verify: API test.
