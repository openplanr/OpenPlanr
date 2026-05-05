<!-- Loaded by backend-agent entry; shared across modes. Normative procedure: docs/rules.md § R6 only. -->

## Correction Protocol (backend DEV)

**Canonical procedure:** **`docs/rules.md`** → **`### R6 — Max 3 Correction Iterations`** — read it before shipping code. Do **not** restate R6 verbatim in prompts or sibling docs.

**After generating files**, run commands from `input/tech/stack.md` in **R6 order**: LintCommand (if set) → TypeCheckCommand (if set) → BuildCommand → TestCommand (must cover unit **and** integration expectations when both apply).

**Iteration‑2 re-read bundle (backend):** active Tech task file · `output/db/schema.json` when DB work applies · `input/tech/stack.md`.

Forbidden shortcuts remain exactly as stated in **R6**.

**Failure handoff:** after **three failed correction passes**, STOP and write the report at the path given in the loaded **`agents/modes/${MODE}/backend.md`** file (basename **`T-<TASK_ID>-error-report.md`** per task **`id`**), using **`${CLAUDE_PLUGIN_ROOT}/templates/error-report.md`** shape.
