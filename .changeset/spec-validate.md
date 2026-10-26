---
'openplanr': minor
---

Add `openplanr spec validate <specId>`, a read-only check of one spec file against the specification contract. It checks the file path, the frontmatter against the Protocol spec schema for its declared `schemaVersion` (a missing or unsupported version is an error), the 13 contract headings in order, and `AC-NNN` ids on every acceptance criterion. It prints each violation with the file and rule, exits 1 when it finds any, and writes nothing. Use `--json` for machine-readable output.

`openplanr spec promote` now says in its help that it marks the spec ready-for-pipeline, and takes `--dry-run` to validate and print the handoff command without writing. Without the flag it behaves as before.

Specs from `openplanr spec create` and `openplanr spec shape` now number their acceptance criteria `AC-001`, `AC-002` and so on, so a new or shaped spec passes `spec validate`.
