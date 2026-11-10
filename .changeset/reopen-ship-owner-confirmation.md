---
'planr-pipeline': patch
---

`openplanr-pipeline reopen-ship` now asks the owner to confirm. Run it in a terminal and type `REOPEN SHIP <receipt hash>` when prompted. It refuses `--json` and non-interactive calls with `E_SHIP_OWNER_INTERACTIVE_REQUIRED` instead of reopening shipped work unconfirmed.

Plan review errors no longer point to a command that does not exist.
