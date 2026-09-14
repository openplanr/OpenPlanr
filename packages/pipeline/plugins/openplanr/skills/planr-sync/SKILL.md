---
name: planr-sync
description: Audit OpenPlanr planning artifacts for graph and protocol drift. Use when statuses, references, schemas, or generated planning views may be inconsistent.
license: MIT
---

# Planr Sync

Run `planr pipeline sync --json` to audit spec ↔ quick-task ↔ tracker alignment.
The command owns graph inspection, classification, and safe local repair. Keep an
ordinary audit read-only; add `--apply` when the user requests local alignment and
`--push` only when the user requests tracker or Git synchronization.

Return aligned, locally repairable, and judgment-needed counts, the paths changed
when applying, and the most useful next command. Preserve the command's diagnostic
when a tracker or integration is unavailable; local audit results remain useful.
