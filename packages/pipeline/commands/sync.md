---
description: Reconcile spec ↔ quick-task ↔ issue-tracker alignment across .planr/ — guarantee every shippable spec carries its externalization Quick Task (the unit pushed to Linear/GitHub for PO + manager visibility), fix deterministic drift, surface judgment calls. Read-only by default.
argument-hint: "[--apply] [--push] [--branch <name>] [--tracker linear|github|auto]"
---

# /planr-pipeline:sync [--apply] [--push] [--branch <name>] [--tracker linear|github|auto]

Read-only by default — never mutates disk or the network unless `--apply` / `--push` (or an
explicit confirmation) is given. Fatals use **`${CLAUDE_PLUGIN_ROOT}/procedures/fatal-error-format.md`**.

Execute `${CLAUDE_PLUGIN_ROOT}/procedures/sync-workflow.md` — it holds the full contract
(why this exists, the three links it reconciles, the seven HARD RULES, the seven Steps, and
Termination). Both this command and the portable `planr-sync` skill read that one procedure,
so the sync workflow is implemented exactly once. "Done" is evidenced, never assumed: a spec
is done only when all its internal tasks are `done` and its ship marker shows
`qa_gate_status: passed`.

## Flags
| Flag | Effect | Default |
|------|--------|---------|
| (none) | Audit + classified report only. No writes, no network. | on |
| `--apply` | Apply the **SAFE-class** fixes locally (status flips, missing wrapper QTs). | off |
| `--push` | After `--apply`, push changed QTs to the tracker, then `git commit` (+ push). | off |
| `--branch <name>` | Branch to operate on. | auto-detect |
| `--tracker <t>` | Force `linear` / `github`; `auto` uses whatever the project configures. | auto |
