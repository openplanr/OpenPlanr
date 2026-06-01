# Parallel Dispatch (SPEC-014)

> Native host-driven parallel dispatch for the DEV phase of `/planr-pipeline:ship`.

This feature lets `/ship` dispatch every ready task as a native parallel `Agent` call in a single orchestrator turn, directly on the shared main working tree.

> **History:** SPEC-014 **supersedes** SPEC-013. SPEC-013 (v0.11.0) wrapped dispatch in a DAG-aware wave scheduler with git-worktree isolation, a file-scoped merge-back, lock-list serialization, and a `--max-parallel` knob. SPEC-014 (v0.12.0) is a deliberate reversal: planr is a planning and orchestration layer, not a runtime sandbox. Parallel write-safety is the host runtime's concern, so all of that machinery was removed in favor of native dispatch.

## Documents

- [`architecture.md`](architecture.md) — how native dispatch works (shared tree, `dependsOn` ordering, advisory lock-list)
- [`api.md`](api.md) — the dispatch contract and the advisory lock-list
- [`conformance.md`](conformance.md) — the native-dispatch fixtures (ND1–ND4) and what they prove
- [`us-001-native-dispatch-core.md`](us-001-native-dispatch-core.md) — the core user story (native parallel dispatch)

## TL;DR

In Claude Code's multi-task mode the orchestrator emits **one `Agent` call per ready task in a single turn**, all writing to the shared main working tree — exactly like native Claude Code parallel sub-agents. No worktree isolation, no merge-back, no `--max-parallel`. planr does no write-set inference and no cycle detection; the only ordering it honors is an explicit `dependsOn:` field. The lock-list survives only as an advisory note in the dispatch prompt. Codex/Cursor (`per-task`) and `single-task` modes dispatch exactly one task per invocation.

## Status

Shipped in v0.12.0 (SPEC-014). The deferred SPEC-013 M2/M3 items (a `dependsOn` DAG engine, `execution-plan.json`, stack-extensible lock lists) are cancelled along with the wave scheduler.
