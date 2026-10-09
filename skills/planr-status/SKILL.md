---
name: planr-status
description: Inspect project delivery or one feature's pipeline status without changing state. Use when the user asks what is done, pending, blocked, or next.
license: MIT
---

# OpenPlanr Status

Inspect delivery state read-only in the active session. Read the repository's
planning artifacts, task statuses, dependency graph, current branch, and relevant
runtime markers directly. Use the optional deterministic `openplanr status --json`
utility when available, but do not require it or a semantic subprocess.

Report counts, ready and blocked work, dependency problems, and the most useful next
action. Do not repair artifacts, start Plan or Ship, or change lifecycle state.

When the OpenPlanr dashboard is running (`planr-dashboard`), the same delivery
state is browsable there: `#/overview` for the whole project, `#/detail/<id>`
for one feature. This is navigation only.

## With nothing connected

The report comes entirely from local planning files and git. When the user asks
for live remote state, report that step as not run, name the category it needs,
and give the current host's step from [connectors](references/connectors.md).

## If ~~project tracker or ~~source control is connected

Add remote lookups only when the user requests live remote state: issue state
from ~~project tracker, pull request and branch state from ~~source control,
through the host's connections as described in the
[tracker sync reference](references/tracker-connections.md). Name the category each
remote fact came from. Status never writes to a remote service.

## Return

Lead with the current delivery state, then summarize ready, blocked and pending
work. Link the relevant planning artifact or dashboard view instead of listing
every item. State the data inspected and its freshness; distinguish local state
from any remote state actually queried. If data is missing or malformed, retain
the useful findings and give the smallest recovery action. Include a next step
only when one is needed. Keep diagnostics in their existing records; summary
wording never requires a second status run.
