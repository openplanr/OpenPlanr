# How SHIP dispatches a coherent task graph

SHIP performs one user-authorized implementation lifecycle. Runtime scheduling may
differ, but task identity, dependency order, review limits, and terminal evidence do
not.

## Runtime behavior

| Runtime capability | Behavior |
|---|---|
| Native subagents | Dispatch every ready task together and roll forward dependents |
| No isolated subagents | Execute the same ready frontier sequentially in this invocation |
| Explicit `--task T-NNN` | Restrict the lifecycle to the named task |

Claude Code and Codex use native subagents when exposed by the host. Cursor uses
the fallback when needed. No runtime asks the user to resume between tasks.

## Graph rules

1. Read the closure runtime's unresolved task graph.
2. Treat `dependsOn` as the only hard ordering input.
3. Dispatch or execute all currently ready work.
4. Submit each exact task result through `advance-ship`.
5. Drain newly ready dependents until no unrecorded ready work remains.
6. Continue to one consolidated professional review.

There is no worktree, merge-back, Planr-side wave scheduler, concurrency flag,
file-overlap scheduler, or prompt-owned status/manifest writer.

## Task correction

Apply `docs/rules.md` R6 only to lint, typecheck, build, or test command failures.
After three failed command-chain corrections, record the task blocked and continue
independent work. Acceptance and professional-review findings use the separate R7
single-correction lifecycle.

## Review termination

Freeze one candidate, reviewer roster, and gate set. Accept one complete P0/P1/P2
finding batch. If P0/P1 exists, allow one correction candidate and one targeted
re-review. Then finalize PASS or BLOCKED. Only an explicit owner command may create
a new run referencing an immutable receipt.

## Bookkeeping

Implementation and QA agents return structured results only. The closure runtime
owns active state, receipts, candidate identity, task status, the human QA projection,
legacy marker/manifest compatibility, and provenance.
