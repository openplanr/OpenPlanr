Release notes are in `CHANGELOG.md`. **Next version: 2.0.0**, a major bump for two breaking changes:
`GET /notes/export` was removed, and `PATCH /notes/:id` now rejects a non-boolean `done` (stated only in
that commit's footer). The title-validation refactor adds a 120-character limit, so it is listed. Pinning
was added and reverted, so it is left out, as are three internal commits and one test-only commit.
