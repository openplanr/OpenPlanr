---
name: planr-sync
description: Audit OpenPlanr planning artifacts for graph and protocol drift. Use when statuses, references, schemas, or generated planning views may be inconsistent.
license: MIT
---

# OpenPlanr Sync

Reconcile local planning artifacts and, when requested, GitHub or Linear state.
Reason about conflicts in this active session. Local and GitHub work never require
the OpenPlanr CLI.

Remote steps run through the host's own connections, as described in
[tracker connections](references/tracker-connections.md), which also holds the status
mapping and what to tell the user when a connection is missing:

- GitHub: the host's GitHub connection, or, when the GitHub CLI is signed in, the
  packaged [sync helper](scripts/sync.mjs), which applies issue operations through `gh`.
  `openplanr github` and `openplanr sync` are optional equivalents.
- Linear: the host's Linear connection.

Audit is read-only by default. Apply local changes only when the request asks for
reconciliation, and push remote changes only when the request asks for external
synchronization. If a connection is unavailable, complete local reconciliation
and report only the external step that could not run.

## Return

Lead with what is aligned, repaired or still blocked. Summarize aligned, locally
repairable, conflict and unavailable counts; link changed paths or remote items
by purpose. State what was actually validated or synchronized and distinguish
local success from an unavailable remote step. Give each material conflict its
impact and recovery action, with one most useful next step. Keep full mapping
and diagnostics in their existing records. Different chat wording never causes
a second synchronization or a corrective run.

When the OpenPlanr dashboard is running, the reconciled graph is browsable at
`#/overview` and recent changes at `#/activity`. This is navigation only.
