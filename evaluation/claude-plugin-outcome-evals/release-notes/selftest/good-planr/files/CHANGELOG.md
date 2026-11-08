# Changelog

## 2.0.0 (2026-11-08)

### Breaking changes

- `GET /notes/export` has been removed. To get your notes as CSV, call `GET /notes` and convert the JSON.

### New

- Filter your note list by status with `GET /notes?done=true` or `?done=false`.
- `GET /notes` now lists notes soonest due first.

### Fixes

- Updating a note with an invalid due date is now rejected with a 400 instead of being saved.
- Note titles are trimmed when you update them, as they already were on create.
