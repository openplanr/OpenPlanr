---
"openplanr": patch
---

Point `test:operate:packed` at the config that owns the packed-install suite.
The suite moved out of the default vitest project so it could not saturate the
shared worker pool, but the script still used the default config, where the file
is now excluded — so it exited "No test files found" instead of running.
