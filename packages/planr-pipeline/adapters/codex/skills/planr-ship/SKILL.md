---
name: planr-ship
description: Execute the reviewed OpenPlanr pipeline DEV and QA phases for a feature.
---

# Planr SHIP

1. Confirm this is a separate user invocation after PLAN review.
2. Run `planr pipeline prepare-ship <feature> --json` and execute ready tasks in
   `dependsOn` order. Use native subagents when available; otherwise apply the
   registry-defined roles sequentially.
3. Respect Create/Modify/Preserve lists and role ownership. Retry a failing task
   at most three times, then write its error report and mark it blocked.
4. Run build and tests from `input/tech/stack.md`, perform the read-only QA gate,
   then run `planr pipeline finalize-ship <feature> --runtime codex --json` so
   manifests, provenance, and the `.pipeline-shipped` marker are written.
