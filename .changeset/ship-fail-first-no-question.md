---
'openplanr': patch
---

`/ship` and `/investigate` no longer ask a question when an acceptance or regression test already passes before the change; they narrow or strengthen the test themselves and report it. `/ship` now reports a check that `ship checks` could not run, such as tsconfig coverage when TypeScript cannot be loaded, and verifies that concern itself.
