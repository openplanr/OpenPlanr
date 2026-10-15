---
'openplanr': patch
---

`openplanr init --repair` adds a missing `targets` or `createdAt` to an existing `.planr/config.json` and keeps every other setting. It shows each field and value before writing and asks to confirm. A config error now names `.planr/config.json` and points to the repair, and `openplanr init` on an existing project fails with `E_ALREADY_INITIALIZED`, suggesting `--repair` or `--force`.
