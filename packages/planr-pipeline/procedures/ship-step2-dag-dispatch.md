# Procedure: `/ship` Step 2 — native parallel dispatch (M1)

Companion to `${CLAUDE_PLUGIN_ROOT}/commands/ship.md` Step 2.

Replaces the per-US sequential walk **when `DISPATCH_MODE == multi-task`**. The other two modes (`per-task`, `single-task`) bypass this file entirely — they keep their existing one-task-per-invocation contract (SPEC-014 FR11). When `DISPATCH_MODE == single-task` *(i.e., `--task T-NNN` bound)* control returns straight to `ship.md` Step 2c without entering this dispatcher.

Dispatch is **prompt-driven, not a runtime engine**: the orchestrator emits one `Agent` tool-call per ready task. There is no daemon, no new process, no new npm dependency, and **no worktree isolation** — agents write directly to the shared working tree. Everything below is executed by the LLM following this procedure in-context.

The **only** hard ordering constraint is the explicit `dependsOn:` task-frontmatter field (the dispatch loop that consumes it is authored in `commands/ship.md` — T-003). planr does **not** infer ordering from file overlap, run cycle detection, or split the queue into write-disjoint waves. The host's native concurrency cap is the only throttle on how many `Agent` calls run at once.

---

## Section 1 — Input contract

Inputs (already bound by `ship.md` Step 1 / Step 2a):

| Name | Type | Source | Notes |
|---|---|---|---|
| `${TASKS}` | list of task records | `ship.md` Step 2a dispatch queue | After `done`-skip + `$SHIP_TASK_ID` narrowing. Each record carries the fields below. |
| `${MODE}` | `default` \| `spec-driven` | `procedures/mode-detection.md` | Drives task-path resolution only; dispatch is mode-agnostic. |
| `${SPEC_DIR}` / `${FEAT_DIR}` | path | mode-detection | Anchors task-file paths. |

Each task record in `${TASKS}` carries:

```yaml
id: "T-NNN"                # YAML frontmatter id, regex ^T-\d{3}$
status: "pending" | "in-progress" | "blocked"
agent: "<agent-slug>"      # frontend-agent | backend-agent | db-agent | …
type: "UI" | "Tech"
dependsOn:                 # optional; the ONLY hard ordering constraint
  - "T-MMM"
```

A task with no `dependsOn` (or an empty list) is ready as soon as it is `pending`/`blocked` and is dispatched without waiting on any sibling.

---

## Section 2 — Advisory lock-list note (non-enforcing)

The shared paths below are surfaced to each dispatched agent as an **advisory hint** in the dispatch prompt. They are **not** an ordering or serialization mechanism: planr does **not** split waves, serialize tasks, or fail a run because two tasks both touch a listed path. The list exists only so an agent editing one of these shared files knows to append rather than clobber and to keep its diff minimal.

```yaml
# planr-pipeline advisory lock list — shared files an agent should treat carefully
# (gitignore-style globs). ADVISORY ONLY — surfaced in the dispatch prompt; enforces nothing.
lock_list:
  - "package.json"
  - "package-lock.json"
  - "pnpm-lock.yaml"
  - "yarn.lock"
  - "**/index.ts"
  - "**/index.js"
  - "prisma/schema.prisma"
  - "**/migrations/**"
```

The dispatch loop (`commands/ship.md` Step 2b-multi — T-003) inlines this list verbatim into the per-task prompt as an advisory note. It triggers no serialization and no wave-splitting.

---

## Section 3 — Dispatch contract

For every ready task `T` in `${TASKS}` (ready = all `dependsOn` entries have `status == done`):

1. **Pre-dispatch status transition (single-writer).** The orchestrator writes the task frontmatter:
   - `status: in-progress`
   - `updated: <today's ISO date>`
   Append one manifest record `{ stage: "ship.task:<T.id>", agent: "<T.agent>", started_at: <now>, exit_status: "pending" }` per task. The `.run-manifest.jsonl` and the task `.md` `status` field are written only by the orchestrator — they stay single-writer (SPEC-014 FR12/FR13).
2. **One Agent tool-call per ready task.** The orchestrator emits one `Agent` tool-call per ready task — many in a single assistant turn when several are ready at once — each with:
   - `subagent_type`: the task's `agent` field (`frontend-agent`, `backend-agent`, `db-agent`, …).
   - `description`: short label `"<T.id> — <task-title-first-35-chars>"`.
   - `prompt`: the standard per-task dispatch prompt (path to the task file, MODE/SPEC_DIR/FEAT_DIR, stack inputs, project-memory block, the advisory lock-list note from Section 2, plus the prior `T-<id>-error-report.md` body when `status` was `blocked` — see `commands/ship.md` Step 2c). The agents write directly to the shared working tree; there is no worktree isolation.
3. **Wait for results.** The orchestrator does not unblock a dependent task until every task it lists in `dependsOn` has returned `done`.
4. **Post-dispatch status transition.** For each task `T`:
   - **Success:** write `status: done`, `updated: <today>`; close the manifest record with `exit_status: "success"`, `ended_at: <now>`, populated `files_written`/`files_modified`.
   - **R6 failure:** write `status: blocked`, `updated: <today>`; write `T-<T.id>-error-report.md` to the mode-resolved tasks folder; close the manifest record with `exit_status: "failure"`. Continue — a single task's R6 failure does **not** abort the rest of the run (matches `commands/ship.md` Step 2c contract). Tasks that `dependsOn` a blocked task are not dispatched.
5. **Loop.** Drop every task that landed `done` from the queue and dispatch any newly-ready tasks (their `dependsOn` set just cleared). Repeat until the queue is empty or only blocked/unreachable tasks remain.
6. **Termination.** When the queue drains, return control to `commands/ship.md` Step 3 (QA Gate). The QA gate verifies every task that ran this invocation; parallelism speeds DEV, it does not weaken QA (SPEC-014 NFR1).

---

## Section 4 — Integration with `commands/ship.md`

`commands/ship.md` Step 2 (multi-task branch only) consumes this contract as follows (the actual wiring is authored by T-003):

1. After Step 2a builds the dispatch queue and applies `$SHIP_TASK_ID` narrowing, AND after Step 2b confirms `DISPATCH_MODE == multi-task`, hand the queue to the dispatch loop.
2. The loop dispatches every ready task (Section 3), honouring only `dependsOn` ordering, and surfaces the advisory lock-list note (Section 2) in each prompt.
3. The loop runs until the queue drains, then returns the per-task outcomes (success / blocked + error-report path) to `ship.md`.
4. `ship.md` Step 3 (QA gate) runs unchanged on the result set.

`per-task` and `single-task` modes never enter this procedure (SPEC-014 FR11). The legacy per-US sequential walk in `commands/ship.md` is preserved verbatim for those modes.

---

## Section 5 — Determinism & replay guarantees

This procedure is deterministic: identical inputs (same task set, same `dependsOn` edges) always produce the same dispatch outcome.

1. **`dependsOn` is the only ordering input.** A task dispatches once every task in its `dependsOn` list is `done`. Tasks with no declared dependency are dispatched as soon as they are ready, in no enforced relative order — the host's native concurrency cap is the only throttle.
2. **Single-writer status & manifest.** Task `.md` `status` fields and `.run-manifest.jsonl` are written only by the orchestrator (Section 3), so concurrent agents cannot race on shipped-state bookkeeping (FR9).
3. **Advisory-only lock list.** The Section 2 lock list is a prompt hint, never a scheduler input — it cannot change which tasks dispatch or in what order.

---

*Reads: the pending/blocked task set (id, status, agent, `dependsOn`).*
*Writes: nothing directly — the orchestrator owns all status/manifest writes.*
*Dispatches: one backend-agent / frontend-agent subagent per ready task via the `Agent` tool.*
