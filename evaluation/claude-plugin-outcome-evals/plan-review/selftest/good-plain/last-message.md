A few things to fix before starting:

- Nothing in the plan lets an owner revoke a link, which the spec requires (requirement 4).
- Task 2 changes what's stored in data/notes.json but has no migration and doesn't bump SCHEMA_VERSION.
  The README says every change to the stored shape needs both, or existing files stop loading.
- Task 3 creates a link for any note id without checking the caller owns that note.
- Task 4 is six days of unrelated work in one task; split it into the read route, read-only enforcement,
  expiry and the end-to-end tests.

The share store (task 1) and the README update (task 5) look good as they are.
