# US-001 — Native Parallel Dispatch Core

> As a developer, I want independent ready tasks to dispatch in parallel so the DEV phase finishes faster — without planr wrapping them in worktrees.

Status: shipped (SPEC-014).

---

## Story

As a developer running `/planr-pipeline:ship` under Claude Code, I want every ready task (those with no unmet `dependsOn:`) to be dispatched together as native parallel `Agent` calls in a single orchestrator turn, all writing to the shared main working tree, so a feature with many independent tasks finishes in fewer turns and planr stays a thin planning/orchestration layer rather than a runtime sandbox.

---

## Acceptance criteria

- Independent ready tasks (no `dependsOn`) dispatch together in one turn — one `Agent` call each.
- Dispatched `Agent` calls carry no `isolation` field; sub-agents write directly to the shared working tree.
- A task with an explicit `dependsOn:` is not dispatched until its declared dependencies are `done`.
- Two tasks that both touch a lock-listed path still dispatch in parallel; the prompt surfaces a non-enforcing advisory note.
- No `--max-parallel` flag and no `$SHIP_MAX_PARALLEL` binding exist — the host's native concurrency cap is the only throttle.
- Codex/Cursor (`per-task`) and `single-task` (`--task T-NNN`) dispatch exactly one task per invocation.
- No `.planr-worktrees/` directory and no `planr-wt/*` branch is ever created.

---

*Core user story for SPEC-014 native parallel dispatch (supersedes the SPEC-013 wave scheduler story).*
