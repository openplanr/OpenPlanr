Tags are in. `createNote` now takes a `tags` option and cleans it up (trimmed, lower-case, no duplicates,
sorted, blanks dropped), rejecting anything that isn't a list of strings, and `POST /notes` passes tags
through so the created note comes back with them.
