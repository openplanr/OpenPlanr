---
name: planr-sync
description: Audit OpenPlanr planning artifacts for graph and protocol drift. Use when statuses, references, schemas, or generated planning views may be inconsistent.
license: MIT
---

# OpenPlanr Sync

Reconcile local planning artifacts and, when requested, ~~project tracker state.
Reason about conflicts in this active session. Local and tracker work never require
the OpenPlanr CLI.

Remote steps run through the host's own ~~project tracker connection. The
[tracker sync reference](references/tracker-connections.md) holds which connection to
use per tracker, the status mapping, link shapes and what to tell the user when a
connection is missing; [connectors](references/connectors.md) lists the trackers
OpenPlanr syncs with and how to connect each in the current host.

When the tracker's own command-line tool is signed in, the packaged
[sync helper](scripts/sync.mjs) creates and edits issues through it; close or reopen an
issue with the same tool. `openplanr sync` only repairs local cross-references.

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
