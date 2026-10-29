---
'openplanr': minor
---

`openplanr ship checks` now reports changed files a passing run may not have checked: untracked files that tracked-only checks such as lint-staged cannot see, and new TypeScript files that no tsconfig includes. The JSON result moves to schema `1.1.0` with a new `coverage` field.
