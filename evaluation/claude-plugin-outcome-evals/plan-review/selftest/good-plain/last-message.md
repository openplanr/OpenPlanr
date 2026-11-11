Several things to fix before starting:

- Nothing in the plan lets an owner revoke a link, which the spec requires (requirement 4).
- Task 3 creates a link for any note id without checking the caller owns that note.
- Task 1's tokens come from `Math.random().toString(36)`, which is guessable; the spec says
  unguessable. Use `crypto.randomBytes`.
- Task 4 puts `GET /shared/:token` after the existing `/notes` routing, but `handle` runs
  `requireUser` first and 404s anything else, so the route needs an `x-user-id` header or never runs.
  The spec says link readers send no header.
- Task 4 returns `present(note)`, which includes `ownerId`, `id` and `done`; the spec only allows title,
  body and due date.
- Task 4 expires links after 7 days; the spec says 30.
- Task 2 changes what's stored in data/notes.json but has no migration and doesn't bump SCHEMA_VERSION.
  The README says every change to the stored shape needs both, or existing files stop loading.
- Task 6 is six days of unrelated work in one task; split it.

Task 5 (errors through the existing helpers) and the README task look right as they are. Showing the current note content is what the spec
wants, and keeping expired records is how an expired token can return 410, so leave both design notes.
