# Changelog

## 2.0.0 (2026-11-08)

### Breaking changes

- `GET /notes/export` has been removed. To get your notes as CSV, call `GET /notes` and convert the JSON.
- `PATCH /notes/:id` now rejects a `done` value that is not `true` or `false` with a 400. Send a boolean,
  not the string `"true"`.

### New

- Filter your note list by status with `GET /notes?done=true` or `?done=false`.
- `GET /notes` now lists notes soonest due first.

### Fixes and limits

- Note titles are limited to 120 characters; longer titles are rejected with a 400.
- Updating a note with an invalid due date is now rejected with a 400 instead of being saved.
- Note titles are trimmed when you update them, as they already were on create.
