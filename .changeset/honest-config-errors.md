---
"openplanr": patch
---

Report an invalid `.planr/config.json` as an actionable error instead of a raw stack trace.

`targets` and `createdAt` are the two config fields required with no default, while every
other field defaults. A config missing either — hand-edited, partially written, or
hand-authored — crashed **every** config-reading command with an unhandled `ZodError`
stack trace, because the CLI's top-level handler rethrows anything without an `E_` code.

The failure now names the file, every failing field with its path, and the command to
repair it, exiting cleanly through the handler's existing error contract. A genuinely
missing required field still fails — it just says so legibly rather than dumping a trace.
