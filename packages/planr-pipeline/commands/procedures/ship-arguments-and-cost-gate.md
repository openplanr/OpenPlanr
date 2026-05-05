# Procedure: normalize `/ship $ARGUMENTS` + targeted task checks + COST ESTIMATE gate

Thin companion to `${CLAUDE_PLUGIN_ROOT}/commands/ship.md`.

`commands/ship.md` **MUST** invoke this file in **two installments**:

1. **Phase A — pre `mode-detection.md`** (snapshot sentinel already written).
2. **Phase B — post required-input validation (`mode-detection § /ship`)**.

---

## Phase A — token hygiene (before Step 1a)

Treat CLI/Cursor **`$ARGUMENTS`** as the raw invocation string after the command name itself.

Iterate whitespace-split tokens left-to-right, consuming known switches:

| Token | Meaning |
|-------|---------|
| `--no-devops` | `$SHIP_SKIP_DEVOPS = true` |
| `--no-docs` | `$SHIP_SKIP_DOCS = true` |
| `--yes` | `$SHIP_ASSUME_YES = true` *(skips Phase B COST interactive halt)* |
| `--task` | Must be followed immediately by `$SHIP_TASK_ID` matching `^T-\\d{3}$` |

**Fatals (`fatal-error-format.md` style — exactly two lines each):**

- `--task` final token ⇒  
  1. ⚠ **`--task` requires `T-<NNN>` (e.g., T-007).**  
  2. **Repair:** `/planr-pipeline:ship <slug> [--flags…] --task T-NNN`

- **`$SHIP_TASK_ID` misses regex** ⇒  
  1. ⚠ **Task ids must match `^T-\\d{3}$` — got `<token>`.**  
  2. **Repair:** `/planr-pipeline:ship <slug> [--flags…] --task T-NNN`

Remaining tokens MUST resolve to **`${SLUG}` only** — kebab-case slug identical to **`plan-step0-preflight.md`** first-token hygiene. Any extra tokens ⇒  
1. ⚠ **Unexpected trailing arguments after `<slug>`.**  
2. **Repair:** `/planr-pipeline:ship <slug> …`

Bind `${SLUG}` for every downstream reference (replace historical `$ARGUMENTS` interpolation).

---

## Phase B — TASK existence validation + COST ESTIMATE (after MODE bound)

 Preconditions: **`mode-detection.md`** populated `MODE`, `SPEC_DIR` (spec-driven), or `FEAT_DIR` (default); AND `/ship` required inputs validated.

### B.1 — Collect candidate task Markdown files (**exclude failure handoffs**)

| `MODE` | Roots / globs |
|--------|----------------|
| `default` | Glob `${FEAT_DIR}/us-*/tasks/task-*.md` |
| `spec-driven` | Glob `<SPEC_DIR>/tasks/T-*.md` excluding `*-error-report.md` suffix |

Reading frontmatter **`id`** (required schema field) resolves canonical task ids regardless of descriptive filename tails.

When `$SHIP_TASK_ID` bound, require ≥1 matched file carrying `id:` **equal** to `$SHIP_TASK_ID`. Else:  
1. ⚠ **`$SHIP_TASK_ID` missing from decomposition for `${SLUG}`.**  
2. **Repair:** `/planr-pipeline:plan ${SLUG}` then `/planr-pipeline:ship ${SLUG} --task $SHIP_TASK_ID`

### B.2 — COST ESTIMATE block (always non-binding wording)

Determine `{tasks_to_run}` multiset:

| Condition | Contents |
|-----------|----------|
| `$SHIP_TASK_ID` absent | Every parsed task artifact |
| present | Strict subset matching that id |

**Opus-class (DEV)** ≈ `{tasks_to_run}.length` frontline passes *(one agent dispatch per targeted task).*  
**Sonnet-class QA** ≈ **`1`** when QA gate executes later — skipped only when **every** DEV task aborts **before** QA can start *(document if that zero-task edge arises).*

Echo:

```
---
ESTIMATE (non-binding):

  Opus-class DEV batches  ≈ <N>
  Sonnet QA gate batches  ≈ <Q>
  Respect prior --no-devops / --no-docs opt-outs mentally when forecasting infra/docs roles.

Totals are heuristic token ranges — telemetry/billing may diverge.

<If $SHIP_ASSUME_YES OR already confirmed this turn→ say "Continuing now.">

<Else→ say "Reply proceed (or re-invoke adding --yes) before dispatching DEV agents.">
---
```

Interactive halt (**when `$SHIP_ASSUME_YES` is false**): **STOP** the orchestrator until explicit human confirmation. Never fabricate consent.

---

Phase B reads task metadata only.
