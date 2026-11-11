## Shipped: 0004 tags on notes (T-001, T-002)

- `src/notes.js`: `createNote` accepts `tags`; they are trimmed, lower-cased, de-duplicated, sorted, and
  empty tags are dropped. Anything other than an array of strings throws a `TypeError`.
- `src/server.js`: `POST /notes` passes `tags` through; invalid tags return 400.
- `test/tags.test.js`: covers cleaning and the no-tags default.

## Verification

Ran `npm test`: 11 passed, 0 failed.
