---
name: planr-sync
description: Audit OpenPlanr planning artifacts for graph and protocol drift. Use when statuses, references, schemas, or generated planning views may be inconsistent.
license: MIT
---

# Planr Sync

Reconcile local planning artifacts and, when requested, GitHub or Linear state.
Reason about conflicts in this active session; deterministic mapping and transport
may use a host connector or the packaged [sync helper](scripts/sync.mjs). The optional
OpenPlanr CLI is never required by the skill.

Resolution order:

1. use a host-native GitHub or Linear connector when available;
2. otherwise use the packaged deterministic helper;
3. optionally use the equivalent `planr github`, `planr linear`, or `planr sync`
   terminal utility when the user has installed it.

Audit is read-only by default. Apply local changes only when the request asks for
reconciliation, and push remote changes only when the request asks for external
synchronization. If credentials are unavailable, complete local reconciliation
and report only the external step that could not run.

Return aligned, locally repairable, conflict, and unavailable counts; changed
paths or remote identifiers; and the single most useful next action.

When the OpenPlanr dashboard is running, the reconciled graph is browsable at
`#/overview` and recent changes at `#/activity`. This is navigation only.
