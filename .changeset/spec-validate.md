---
'openplanr': minor
---

Adds `openplanr spec validate <specId>`, a read-only check of a spec against the specification contract: frontmatter schema, the 13 headings in order, and `AC-NNN` ids on acceptance criteria. It prints each violation and exits 1 if any are found. `--json` gives machine-readable output.

`openplanr spec promote` takes `--dry-run` to validate and print the handoff command without writing. `spec create` and `spec shape` now number acceptance criteria `AC-001`, `AC-002` and so on, so new specs pass validation.
