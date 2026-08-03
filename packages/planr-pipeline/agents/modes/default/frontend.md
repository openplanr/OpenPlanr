<!-- agents/modes/default/frontend.md: default-mode-only content for frontend-agent. Loaded by agents/frontend-agent.md when MODE=default. T-002 of SPEC-002. -->

> **Mode:** default
> **Loaded by:** `agents/frontend-agent.md` when the orchestrator passes `MODE=default` (no `SPEC_DIR`).

## Path Resolution

The orchestrator (`/ship`) passes the absolute task file path and `MODE=default` when invoking this agent.

- Task file: `output/feats/feat-{name}/us-{N}/tasks/task-{M}.md` (`task-1.md` for UI tasks).
- Design spec (optional): `output/feats/feat-{name}/design-spec.md`.
- Error-report basename after **R6** cap exhausted: **`T-<TASK_ID>-error-report.md`** next to the sibling task file; **`TASK_ID` == YAML `id`**. Example: `output/feats/feat-{name}/us-{N}/tasks/T-001-error-report.md`.

Task content (Create/Modify/Preserve, Type, agent, DoD) is schema-identical in both modes — your behavior doesn't change, only the output paths.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `output/feats/feat-{name}/us-{N}/tasks/task-1.md` | Specification Agent | Yes |
| `output/feats/feat-{name}/design-spec.md` | Designer Agent | If exists |
| `input/tech/stack.md` | Tech Lead | Yes |
| Existing codebase files (for context) | Dev environment | Read-only for context |

---

## Outputs

All files listed under `### Create` and `### Modify` in the task file (`output/feats/feat-{name}/us-{N}/tasks/task-1.md`).

---

## Execution Steps

```
1. Load output/feats/feat-{name}/us-{N}/tasks/task-1.md → extract file lists (Create / Modify / Preserve)
2. Load output/feats/feat-{name}/design-spec.md if it exists
3. Load input/tech/stack.md → extract UIFramework, CSSStrategy, ComponentLibrary
   3a. For each path in ActiveStackFiles → load that stack file's conventions
       (e.g. ${CLAUDE_PLUGIN_ROOT}/stacks/frontend/nextjs.md)
   3b. Stack file conventions OVERRIDE generic templates.
4. For each file in "Create":
   a. Generate the full implementation
   b. Apply design tokens from design-spec.md
   c. Follow stack conventions
   d. Write unit tests alongside
5. For each file in "Modify":
   a. Read the existing file
   b. Apply only the described changes
   c. Preserve all existing logic not mentioned
6. Verify "Preserve" list — confirm none of those files were touched
7. Run build check (compile / type check)
8. If verification fails → enter correction passes (cap = **R6**; see `agents/modes/shared/correction-loop-frontend.md` + **docs/rules.md § R6**)
9. If still failing after that cap → write `…/tasks/T-<TASK_ID>-error-report.md` and stop
10. Log: "Frontend Agent complete. task-1 done → [files created/modified]"
```

---

## Correction — mode-specific tail (**R6**)

When the **R6** correction cap is exhausted (see `agents/modes/shared/correction-loop-frontend.md`):

```
STOP. Write `output/feats/feat-{name}/us-{N}/tasks/T-<TASK_ID>-error-report.md`
      using the schema in ${CLAUDE_PLUGIN_ROOT}/templates/error-report.md. Do not proceed.
```

Forbidden shortcuts match **R6** exactly (no extra waivers unless the task authorizes them).

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| task-1.md missing | Error: "No UI task found. Run PO Phase first." |
| design-spec.md missing | Proceed without design tokens, flag in output log |
| Compile error after **R6** correction cap | Stop, write `…/tasks/T-<TASK_ID>-error-report.md` per `${CLAUDE_PLUGIN_ROOT}/templates/error-report.md` schema |
| Component library not installed | Flag in output, suggest install command |
| File in "Preserve" was modified | Self-correct immediately — revert and re-implement |

---

*Reads: task-1.md · design-spec.md · stack.md*
*Writes: UI layer files only*
*Runs in parallel with: Backend Agent (task-2)*
