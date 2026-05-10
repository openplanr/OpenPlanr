<!-- Loaded by frontend-agent entry; shared across modes. Normative procedure: docs/rules.md § R6 only. -->

## Correction Protocol (frontend DEV)

**Canonical procedure:** **`docs/rules.md`** → **`### R6 — Max 3 Correction Iterations`** — read it before shipping code. Do **not** restate R6 verbatim in prompts or sibling docs.

**After generating files**, run commands from `input/tech/stack.md` in **R6 order**: LintCommand (if set) → TypeCheckCommand (if set) → BuildCommand → TestCommand.

**Iteration‑2 re-read bundle (frontend):** active UI task file · `design-spec.md` when present · `input/tech/stack.md`.

**Memory trap append (iteration 2+):** when entering iteration 2, append a trap entry to `.planr/memory.md` under `## Traps`: `- [YYYY-MM-DD, T-<TASK_ID>] <what failed in iteration 1 and the fix approach>`. Create the file from `${CLAUDE_PLUGIN_ROOT}/templates/memory.md.tpl` if absent. Keep entries to 1-2 lines.

Forbidden shortcuts remain exactly as stated in **R6** (no `--no-verify`, unjustified `@ts-ignore`, bogus `skip()`, etc.).

**Failure handoff:** after **three failed correction passes**, STOP and write the report at the path given in the loaded **`agents/modes/${MODE}/frontend.md`** file (basename **`T-<TASK_ID>-error-report.md`** per task **`id`**), using **`${CLAUDE_PLUGIN_ROOT}/templates/error-report.md`** shape.
