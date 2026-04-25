---
description: Run the DEV Phase pipeline for a feature (frontend + backend agents per task, then qa, devops, doc-gen, then snapshot)
argument-hint: <feature-name>
---

# /openplanr-pipeline:ship {feature-name}

Orchestrates the DEV Phase for `feat-$ARGUMENTS`. Generates production code from PO-Phase task files, runs the qa-agent gate, optionally generates infra and docs, then refreshes `CLAUDE.md` via the snapshot skill.

**Per `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1, this command MUST NOT be auto-chained from `/openplanr-pipeline:plan`.** A human review step is mandatory between PO Phase and DEV Phase.

---

## Step 0 — Write snapshot sentinel

Touch `.claude/.snapshot-pending` so the Stop hook (in `${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json`) fires a reminder if this command aborts before reaching Step 5.

---

## Step 1 — Validate inputs

Verify these exist. Abort with a clear error if any are missing.

Required:
- `output/feats/feat-$ARGUMENTS/` — fail with: "feat-$ARGUMENTS/ not found. Run /openplanr-pipeline:plan $ARGUMENTS first."
- At least one `output/feats/feat-$ARGUMENTS/us-*/us-*.md` — fail with: "No User Stories found. Re-run /openplanr-pipeline:plan $ARGUMENTS."
- At least one `output/feats/feat-$ARGUMENTS/us-*/tasks/task-*.md` — fail with: "No tasks found. Re-run /openplanr-pipeline:plan $ARGUMENTS."
- `input/tech/stack.md` — fail with: "stack.md missing."

Recommended:
- `output/db/schema.json` — warn if missing, continue (some features don't touch DB).
- `output/feats/feat-$ARGUMENTS/design-spec.md` — warn if missing, continue (no UI tasks if no design spec).

---

## Step 2 — Iterate User Stories in topological order

For each `us-{N}` directory under `output/feats/feat-$ARGUMENTS/` (sorted by US number):

1. Read `us-{N}/us-{N}.md` to determine task ownership.
2. For each `tasks/task-{M}.md`:
   - Read the task's frontmatter `Type` field.
   - If `Type: UI` → delegate to the **frontend-agent** subagent (Opus 4.7).
   - If `Type: Tech` → delegate to the **backend-agent** subagent (Opus 4.7).
   - frontend-agent and backend-agent tasks within the SAME US may run in parallel (per `${CLAUDE_PLUGIN_ROOT}/docs/pipeline-overview.md`).
3. Each subagent applies the **3-iteration correction loop** (see `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R6):
   - Iteration 1: direct fix on build/test failure.
   - Iteration 2: re-read task spec + design-spec/schema, fix holistically.
   - Iteration 3: minimal safe fix, flag remaining issues.
   - On 3rd failure: write `${CLAUDE_PLUGIN_ROOT}/templates/error-report.md`-shaped report to `output/feats/feat-$ARGUMENTS/us-{N}/tasks/error-report.md` and STOP that task.
4. If a task fails after 3 iterations, ship continues with other independent tasks but flags the failed task in the final summary.

---

## Step 3 — QA Gate (Step 3.5)

After all US tasks complete (or fail with error-reports), delegate to the **qa-agent** subagent.

The qa-agent verifies, for each task:
- All "Create" files exist
- All "Modify" files were updated (and only as described)
- All "Preserve" files are unchanged (git diff vs base)
- Tests exist and pass (`BuildCommand` + `TestCommand` from stack.md)
- DoD checklist items are satisfied

If QA fails: flag the failure in summary; **still proceed to Step 5 snapshot** so state is recorded, but skip DevOps and Doc-Gen agents until the underlying task is fixed.

---

## Step 4 — DevOps + Doc-Gen Agents (Step 3.5, parallel, optional)

These run only if QA passes. Skipped via `--no-devops` / `--no-docs` flags in $ARGUMENTS.

- Delegate to the **devops-agent** subagent — generates `docker-compose.yml`, `.env.example`, Dockerfiles, and CI config matching the stack. Per non-goals: this subagent **does NOT deploy** (enforced at the tool layer — the agent has no Bash access).
- Delegate to the **doc-gen-agent** subagent — writes `Docs/feat-$ARGUMENTS/` from the US, tasks, and generated source code.

---

## Step 5 — Snapshot

Invoke the `/openplanr-pipeline:snapshot` skill to refresh `CLAUDE.md` with the latest project state. On success, remove the `.claude/.snapshot-pending` sentinel.

The Stop hook in `${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json` is a backup: if this command aborts before this step, the hook prints a reminder to manually run `/openplanr-pipeline:snapshot`.

---

## Step 6 — Print summary

```
✓ DEV Phase complete for feat-$ARGUMENTS
  Tasks succeeded: X / Y
  Tasks failed:    Z (see error-report.md files)
  QA gate:         <passed | failed>
  DevOps config:   <generated | skipped>
  Docs:            <generated | skipped>
  CLAUDE.md:       refreshed
```

If any task failed, list paths to the error-report.md files.

---

## Failure modes

| Condition | Action |
|-----------|--------|
| feat folder missing | Abort, suggest `/openplanr-pipeline:plan $ARGUMENTS` |
| No tasks | Abort, suggest re-run of PO Phase |
| Single task fails 3x | Continue with other tasks, surface in summary |
| All tasks fail | Skip QA + DevOps + Doc-Gen; still run snapshot to record state |
| QA gate fails | Skip DevOps + Doc-Gen; still run snapshot |

---

*Reads: output/feats/feat-{name}/, stack.md, schema.json, design-spec.md*
*Writes: src/features/{name}/, tests, docker-compose.yml (optional), Docs/ (optional), CLAUDE.md (via snapshot)*
*Per `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1: must be invoked manually after human review of PO Phase output.*
