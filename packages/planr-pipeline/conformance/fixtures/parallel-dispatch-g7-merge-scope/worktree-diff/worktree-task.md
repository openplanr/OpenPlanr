---
id: "T-001"
title: "Add feature module (file-scoped merge target)"
specId: "SPEC-G7"
slug: "merge-scope"
schemaVersion: "1.0.0"
type: "Tech"
agent: "backend-agent"
status: "in-progress"
---

# T-001 — Add feature module (file-scoped merge target)

THIS IS THE WORKTREE'S ROGUE COPY of the task .md. The agent (incorrectly)
left `status: in-progress` here and even edited the body inside its worktree.
If a branch merge were used, this would clobber main's orchestrator-written
`status: done`. The file-scoped checkout NEVER applies this file, so main's
copy is unaffected. This file exists ONLY to prove the non-round-trip: the
verifier asserts main's task .md status is `done`, not `in-progress`.
