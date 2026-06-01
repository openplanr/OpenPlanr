# Architecture — Native Parallel Dispatch

> How native parallel dispatch works: shared working tree, `dependsOn` ordering, advisory lock-list.

Status: descriptive (SPEC-014).

---

## Overview

Native parallel dispatch is deliberately thin. There is no scheduler engine, no isolation layer, and no merge layer. The orchestrator simply:

1. Computes the **ready set** — tasks whose declared `dependsOn:` dependencies (if any) are already `done`.
2. Emits **one `Agent` tool-call per ready task** in a single assistant turn.
3. Sub-agents write **directly to the shared main working tree** (no `isolation`).
4. After each task, the orchestrator records `status` and the `.run-manifest.jsonl` line in the main tree (single-writer bookkeeping, retained).

The host runtime owns concurrency and throttling via its native cap. planr does **no** write-set inference and **no** cycle detection.

---

## Ordering — `dependsOn` only

The ONLY hard ordering constraint planr honors is an explicit `dependsOn:` field already declared in a task's frontmatter (an array of `^T-\d{3}$` task IDs). When present, a dependent task is held back until every declared dependency is `done`, then dispatched in a later turn. Absent `dependsOn`, all ready tasks dispatch together in one turn.

This is a field read, not inference. Most tasks declare no `dependsOn`, so most features dispatch fully in parallel.

---

## Advisory lock-list

The lock-list (`package.json`, lockfiles, `**/index.ts`, `**/index.js`, `prisma/schema.prisma`, `**/migrations/**`) is retained **only as an advisory hint** surfaced in the dispatch prompt — e.g. "these tasks both touch `package.json` — consider ordering." It triggers no serialization, no wave-splitting, and no enforcement. The host is free to act on it or ignore it.

---

## Sequential paths

Codex/Cursor (`per-task` mode) and `single-task` mode (`--task T-NNN`) dispatch exactly one task per invocation — the only sequential paths. They never enter parallel emission.

---

## What was removed (SPEC-013 → SPEC-014)

- The DAG wave **serialization** engine (write-set normalization, cycle detection, lock-list-driven serialization, greedy wave selection).
- Git-worktree isolation (`.planr-worktrees/<id>` dirs, `planr-wt/<id>-<slug>` branches, dependency-dir symlinking, `isolation: "worktree"` on dispatches).
- The file-scoped merge-back and the undeclared-write guard.
- The startup worktree reconcile sweep.
- The `--max-parallel` flag and the `$SHIP_MAX_PARALLEL` binding.

The accepted tradeoff: planr no longer guarantees write-isolation between parallel agents. Collision avoidance moves to good task decomposition, the advisory lock-list hint, and the host agent's judgment.

---

*Pairs with `api.md` and `conformance.md`.*
