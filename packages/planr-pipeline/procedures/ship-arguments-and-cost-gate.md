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

**For each task in `{tasks_to_run}`, read frontmatter** to extract: `id`, `title`, `type`, `agent`, `status`. Count the items in the task body's `### Create` and `### Modify` file lists.

**Partition by status:**
- `done` → skip count
- `pending` / `in-progress` / `blocked` → dispatch count

**Compute estimates:**

| Metric | Heuristic |
|--------|-----------|
| **Tokens per task (input)** | ~5k base context (stack + schema + task spec) + ~2k per Create file + ~1k per Modify file |
| **Tokens per task (output)** | ~3k per Create file + ~1k per Modify file |
| **QA gate** | ~30k input (reads all task specs + generated source + runs build/test) |
| **DevOps / Doc-Gen** | ~15k each (Sonnet, skipped if flagged) |
| **Dollar cost** | Opus 4.8: ~$15/M input + ~$75/M output *(indicative — verify against the current Anthropic price card)*. Sonnet 4.6: ~$3/M input + ~$15/M output. |
| **Time** | `multi-task`: ~1.5 min/task. `per-task`: ~2.5 min/task (includes user re-invoke overhead). |

Echo a structured estimate:

```
COST ESTIMATE — {SLUG}

  Dispatch:  {dispatch_count} task(s) ({pending_count} pending, {blocked_count} blocked, {done_count} done/skipped)
  Runtime:   {RUNTIME} → {DISPATCH_MODE}

  Task        Title                           Create  Modify  Agent
  T-001       <title, max 35 chars>           <N>     <N>     <agent> (Opus 4.8)
  T-002       <title>                         <N>     <N>     <agent> (Opus 4.8)
  ...
  ────────────────────────────────────────────────────────────
  Subtotal    {dispatch_count} tasks           <sum>   <sum>

  Post-DEV    QA (Sonnet 4.6){" + DevOps" if not skipped}{" + Doc-Gen" if not skipped}

  Est. tokens:  ~{min_input}k–{max_input}k input / ~{min_output}k–{max_output}k output
  Est. cost:    ${min_cost}–${max_cost}
  Est. time:    {min_time}–{max_time} min

  Reply "proceed" or narrow with --task T-NNN.
```

**Range multiplier:** apply ×0.8 for min and ×1.3 for max on the per-task heuristics. R6 retries (iteration 2/3) are NOT pre-counted — they add cost if triggered but are not predictable.

Interactive halt (**when `$SHIP_ASSUME_YES` is false**): **STOP** the orchestrator until explicit human confirmation. Never fabricate consent. When `$SHIP_ASSUME_YES` is true, print the estimate block once then continue without halting.

---

Phase B reads task metadata only.
