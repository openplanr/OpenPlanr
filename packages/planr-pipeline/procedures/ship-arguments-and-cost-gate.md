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
| `--yes` | `$SHIP_ASSUME_YES = true` *(skips Phase B COST interactive halt; implies dispatch style `native`)* |
| `--task` | Must be followed immediately by `$SHIP_TASK_ID` matching `^T-\\d{3}$` |
| `--all-tasks` | `$SHIP_FORCE_MULTI = true` *(force `multi-task` on a host that can run parallel subagents)* |
| `--workflow` | `$SHIP_DISPATCH_STYLE = workflow` *(Claude Code multi-task only; ignored on other runtimes)* |
| `--native` | `$SHIP_DISPATCH_STYLE = native` *(the default; explicit opt-in)* |

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

**Phase A bound outputs** (consumed by `commands/ship.md`): `${SLUG}`, `$SHIP_SKIP_DEVOPS`, `$SHIP_SKIP_DOCS`, `$SHIP_ASSUME_YES`, `$SHIP_FORCE_MULTI` (when present), `$SHIP_DISPATCH_STYLE` (when `--workflow`/`--native` present), and `$SHIP_TASK_ID` (when present). There is no width knob — the host's native concurrency cap is the only throttle on `commands/ship.md` §2b-multi dispatch (see `procedures/ship-step2-dag-dispatch.md`). `$SHIP_DISPATCH_STYLE` selects only *how* the wide fan-out is scheduled (`native` vs `workflow`), never how wide.

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
| **Dollar cost** | Opus 4.8: ~$15/M input + ~$75/M output *(indicative — verify against the current Anthropic price card)*. Sonnet 5: ~$3/M input + ~$15/M output. |
| **Wall-clock time** | `multi-task`: tasks run **concurrently** → ~1.5 min × the **longest `dependsOn` chain depth**, NOT the task count. A flat 6-task feature (no chains) is ~1.5–2 min, not ~9. `per-task`: ~2.5 min/task **summed** (sequential + re-invoke overhead). |

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

  Post-DEV    QA (Sonnet 5){" + DevOps" if not skipped}{" + Doc-Gen" if not skipped}

  Est. tokens:  ~{min_input}k–{max_input}k input / ~{min_output}k–{max_output}k output
  Est. cost:    ${min_cost}–${max_cost}
  Est. time:    {min_time}–{max_time} min
```

**Range multiplier:** apply ×0.8 for min and ×1.3 for max on the per-task heuristics. The estimate is per-task token/cost arithmetic only — it has no parallelism knob (native concurrency speeds wall-clock time but does not change total token spend). R6 retries (iteration 2/3) are NOT pre-counted — they add cost if triggered but are not predictable.

### B.3 — The confirmation + dispatch-style gate (a clickable AskUserQuestion, never a typed magic word)

When **`$SHIP_ASSUME_YES` is true**: print the estimate block once, set `DISPATCH_STYLE = native`
(if not already bound by a flag), then continue without halting. Otherwise the gate is a
**mandatory `AskUserQuestion` tool call** — the same enforcement as `/design` Phase B
(`design-step1-clarify.md` "B — Enforcement"):

- **Issue the actual tool call.** Never narrate *"Reply `proceed` to ship"* and stop — the
  user must get a real prompt with clickable options, not a magic word to type.
- Put the **one-line spend summary in the question text**, and note that wide fan-out costs the
  **same total tokens** as going narrow — it only saves wall-clock — so "ship" is the
  cost-neutral default and "narrow" is for scoping, not saving money.

**Style is live** when `RUNTIME == claude-code` AND `DISPATCH_MODE == multi-task` AND no
`--workflow`/`--native` flag was passed. The gate then lets the user pick *how* the wide
dispatch runs (this is the "ship in a workflow vs ship freely" choice):

> **Ship {dispatch_count} task(s)?** Est. **${min_cost}–${max_cost}** · ~{min_time}–{max_time} min wall-clock · same total tokens either way. (Pass `--no-devops`/`--no-docs` to skip extras.)
> A) **Ship — free dispatch** *(recommended)* — native fan-out; Claude dispatches every ready task as it sees fit
> B) **Ship — structured workflow** — the Workflow tool schedules the `dependsOn` DAG deterministically (replayable)
> C) **Narrow the batch** — name the task(s); re-estimate that subset (same as `--task T-NNN`)
> D) **Cancel** — nothing dispatched

- **A** → `DISPATCH_STYLE = native`, dispatch. **B** → `DISPATCH_STYLE = workflow`, dispatch
  via §2b-workflow. **C** → bind the subset, recompute B.2, re-gate. **D** → STOP cleanly.

**Style is not live** (a flag set it, or runtime is cursor/codex/unknown, or `--task`): the
gate is the plain confirmation — no style row:

> **Ship {dispatch_count} task(s)?** Est. **${min_cost}–${max_cost}** · ~{min_time}–{max_time} min.
> A) **Ship the batch** *(recommended)* · B) **Narrow the batch** · C) **Skip extras** (`--no-devops`/`--no-docs`) · D) **Cancel**

- **A** → dispatch (style already resolved). **B** → subset + re-gate. **C** → flip flags,
  re-gate. **D** → STOP cleanly.

- **Fallback (no AskUserQuestion variant callable — e.g. a rule-generated runtime):** fall back
  to the legacy typed gate — print
  `Reply "proceed" to ship, or narrow with --task T-NNN.` and **STOP** until the user replies.
  Never fabricate consent on either path. (Rule-generated runtimes are cursor/codex → per-task,
  so no style choice applies there anyway.)

---

Phase B reads task metadata only.
