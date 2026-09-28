---
name: planr-sync
description: Audit OpenPlanr planning artifacts for graph and protocol drift. Use when statuses, references, schemas, or generated planning views may be inconsistent.
license: MIT
---

# Planr Sync

Reconcile local planning artifacts and, when requested, GitHub or Linear state.
Reason about conflicts in this active session; deterministic mapping and GitHub
transport may use a host connector or the packaged [sync helper](scripts/sync.mjs).
Local and GitHub work never require the OpenPlanr CLI.

Resolution order:

1. use a host-native GitHub or Linear connector when available;
2. otherwise, for GitHub, use the packaged deterministic helper;
3. otherwise, for Linear, use the `planr linear` terminal utility when the user has
   installed it; `planr github` and `planr sync` are optional equivalents for the rest.

Linear through the CLI:

- the user runs `planr linear init` in a terminal once; it prompts for a personal
  access token, which the CLI stores;
- audit with `planr linear sync --dry-run`, which reads Linear without writing;
- before a real `planr linear sync`, ask how conflicts should resolve and pass
  `--on-conflict local` or `--on-conflict linear`; without a prompt it favors Linear;
- `planr linear push <artifact-id>` creates or updates Linear issues; preview with
  `--dry-run`. Quick tasks and backlog items need `linear.standaloneProjectId` in the
  project config when no terminal prompt is available.

Audit is read-only by default. Apply local changes only when the request asks for
reconciliation, and push remote changes only when the request asks for external
synchronization. If credentials are unavailable, complete local reconciliation
and report only the external step that could not run.

Return aligned, locally repairable, conflict, and unavailable counts; changed
paths or remote identifiers; and the single most useful next action.

When the OpenPlanr dashboard is running, the reconciled graph is browsable at
`#/overview` and recent changes at `#/activity`. This is navigation only.
