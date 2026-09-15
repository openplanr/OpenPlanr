---
name: planr-status
description: Inspect project delivery or one feature's pipeline status without changing state. Use when the user asks what is done, pending, blocked, or next.
license: MIT
---

# Planr Status

Use the public `planr` parser and remain read-only.

1. For a project delivery report, run `planr status --md`. Add live GitHub or
   Linear lookups only when the user explicitly asks for them.
2. For one feature or spec, run `planr pipeline status <slug>` and preserve the
   engine's reported counts, marker state, failures, and timing. Do not infer
   progress from source code or stale build output.
3. Prefer `--json` when another tool will consume the result; otherwise return
   the engine output without reclassifying statuses.
4. Never repair artifacts, start PLAN or SHIP, or write lifecycle state from a
   status request.
