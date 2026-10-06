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

Add GitHub or Linear lookups only when the user requests live remote state, through
the host's connections as described in [tracker connections](references/tracker-connections.md).
Keep local results useful when a connection is unavailable, and name the one to add.
Report counts, ready and blocked work, dependency problems, and the most useful next
action. Do not repair artifacts, start Plan or Ship, or change lifecycle state.

When the OpenPlanr dashboard is running (`planr-dashboard`), the same delivery
state is browsable there: `#/overview` for the whole project, `#/detail/<id>`
for one feature. This is navigation only.

## Return

Lead with the current delivery state, then summarize ready, blocked and pending
work. Link the relevant planning artifact or dashboard view instead of listing
every item. State the data inspected and its freshness; distinguish local state
from any remote state actually queried. If data is missing or malformed, retain
the useful findings and give the smallest recovery action. Include a next step
only when one is needed. Keep diagnostics in their existing records; summary
wording never requires a second status run.
