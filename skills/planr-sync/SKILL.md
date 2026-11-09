---
name: planr-sync
description: Audit OpenPlanr planning artifacts for graph and protocol drift. Use when statuses, references, schemas, or generated planning views may be inconsistent.
license: MIT
---

# OpenPlanr Sync

Reconcile local planning artifacts and, when requested, ~~project tracker state.
Reason about conflicts in this active session. Local work and tracker work through
the host's connection never require the OpenPlanr CLI.

Remote steps run through the host's own ~~project tracker connection. The
[tracker sync reference](references/tracker-connections.md) holds which connection to
use per tracker, the status mapping, link shapes and what to tell the user when a
connection is missing; [connectors](references/connectors.md) lists the trackers
OpenPlanr syncs with and how to connect each in the current host.

When the host has no tracker connection but the GitHub CLI is signed in, issue
changes run through `openplanr sync tracker github sync --input <operations.json> --json`:
it previews, and with `--apply` creates, updates, closes or reopens each issue. Check the
CLI first with [the OpenPlanr CLI probe](references/openplanr-cli.md); `--help` lists
the operation fields. Other trackers go through the host's connection only.
`openplanr sync` only repairs local cross-references.

Audit is read-only by default. Apply local changes only when the request asks for
reconciliation, and push remote changes only when the request asks for external
synchronization. If a connection is unavailable, complete local reconciliation
and report only the external step that could not run.

## With nothing connected

Audit and local reconciliation run in full. Report the remote step as not run,
name ~~project tracker as the category it needs, and give the current host's step
from [connectors](references/connectors.md).

## If ~~project tracker is connected

Before any remote write, list every issue change: each issue to create, update,
close or reopen, with its title and the status it moves to. Write only when the
request explicitly asked for that push or the user approves the list. Afterwards,
report each item that was not updated and why, and name the category and product
the changes went to.

Through the CLI, the preview without `--apply` is that list. After `--apply`, an
`E_SYNC_TRACKER_APPLY_INCOMPLETE` result marks each operation `applied`, `failed` or
`not-run`; report the failed and not-run ones with the `recovery` step.

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
