---
name: planr-status
description: Inspect project delivery or one feature's pipeline status without changing state. Use when the user asks what is done, pending, blocked, or next.
license: MIT
---

# Planr Status

Inspect delivery state read-only in the active session. Read the repository's
planning artifacts, task statuses, dependency graph, current branch, and relevant
runtime markers directly. Use the optional deterministic `planr status --json`
utility when available, but do not require it or a semantic subprocess.

Add GitHub or Linear lookups only when the user requests live remote state. Keep
local results useful when credentials or connectors are unavailable. Report
counts, ready and blocked work, dependency problems, and the most useful next
action. Do not repair artifacts, start Plan or Ship, or change lifecycle state.

When the OpenPlanr dashboard is running (`planr-dashboard`), the same delivery
state is browsable there: `#/overview` for the whole project, `#/detail/<id>`
for one feature. This is navigation only.
