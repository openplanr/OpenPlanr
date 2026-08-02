<!-- agents/modes/default/backend.md: default-mode-only content for backend-agent (DEV Tech tasks only). Loaded by agents/backend-agent.md when MODE=default. -->

> **Mode:** default
> **Loaded by:** `agents/backend-agent.md` when the orchestrator passes `MODE=default` (no `SPEC_DIR`).

## Path Resolution

The orchestrator (`/ship`) passes the absolute task file path and `MODE=default` when invoking this agent.

- Task file: `output/feats/feat-{name}/us-{N}/tasks/task-{M}.md` (`task-2.md` for Tech tasks, or sole `task-1.md` when no PNG).
- Error-report basename if **R6** correction cap exhausted: **`T-<TASK_ID>-error-report.md`** beside the sibling task Markdown, where **`TASK_ID` == YAML `id`** on that task *(pattern `^T-\d{3}$`)*. Example path: `output/feats/feat-{name}/us-{N}/tasks/T-002-error-report.md`.

**Step 0.2 entity scaffold** (`output/db/schema.json` → `output/src/`): use **`agents/entity-scaffold-agent.md`** — not this file.

---

## Inputs (Dev Mode — Step 3)

| Input | Source | Required |
|-------|--------|----------|
| `output/feats/feat-{name}/us-{N}/tasks/task-2.md` (or sole `task-1.md`) | Specification Agent | Yes |
| `input/tech/stack.md` | Tech Lead | Yes |
| `output/db/schema.json` | DB Agent | When referencing the DB |
| Existing codebase (read context) | Dev environment | Read-only |

---

## Outputs (Dev Mode — Step 3)

All files listed under `### Create` and `### Modify` in the task file (`output/feats/feat-{name}/us-{N}/tasks/task-{M}.md`).

---

## Execution Steps — Dev Mode

```
1. Load the active Tech task file (task-2.md, or sole task-1.md when no PNG) → extract file lists + technical spec
2. Load input/tech/stack.md → extract Language, Framework, ORM, APIStyle
   2a. For each path in ActiveStackFiles → load that stack file's conventions
       (e.g. ${CLAUDE_PLUGIN_ROOT}/stacks/backend/nestjs.md, ${CLAUDE_PLUGIN_ROOT}/stacks/database/prisma.md)
   2b. Stack file conventions OVERRIDE generic templates.
3. Load output/db/schema.json → validate table/column references in task
4. For each file in "Create":
   a. Generate full implementation
   b. Write unit test file alongside
   c. Write integration test if endpoint created
5. For each file in "Modify":
   a. Read existing file
   b. Apply only described changes
   c. Preserve all existing logic not mentioned
6. Verify "Preserve" list — confirm untouched
7. Run build check (compile + test run)
8. If failing → correction passes (cap = **R6**; see `agents/modes/shared/correction-loop-backend.md` + **docs/rules.md § R6**)
9. If still failing after that cap → write `…/tasks/T-<TASK_ID>-error-report.md` (matching this task frontmatter **`id:`**) and stop
10. Log: "Backend Agent complete — Tech task → [files created/modified]"
```

---

## Correction — mode-specific tail (**R6**)

When the **R6** correction cap is exhausted (see `agents/modes/shared/correction-loop-backend.md`):

```
STOP. Write `output/feats/feat-{name}/us-{N}/tasks/T-<TASK_ID>-error-report.md`
      using the schema in ${CLAUDE_PLUGIN_ROOT}/templates/error-report.md. Do not proceed.
```

Forbidden shortcuts match **R6** exactly.

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| task-2.md missing | Silently skip — no Tech task means no PNG was present |
| schema.json missing | Warning: proceed with best effort, flag missing schema |
| DB table not in schema | Flag in task output: "Table {name} not found in schema.json" |
| Compile error after **R6** correction cap | Stop, write `…/tasks/T-<TASK_ID>-error-report.md` per `${CLAUDE_PLUGIN_ROOT}/templates/error-report.md` schema |
| "Preserve" file modified | Self-correct immediately — revert |

---

*Reads: task-2.md · stack.md · schema.json*
*Writes: backend layer files only*
*Runs in parallel with: Frontend Agent (task-1)*
