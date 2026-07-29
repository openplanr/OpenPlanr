---
"openplanr": patch
---

Report a missing OpenPlanr configuration as the actionable advisor error instead
of an unexpected internal failure. `planr operate init` writes
`.planr/operate/config.json`, not the project-wide `.planr/config.json`, so a
project that ran only the operate initializer reached the structured adapter
with no config at all and surfaced "an unexpected internal Operating Board
error" on the primary first-run path.
