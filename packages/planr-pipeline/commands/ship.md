---
description: Run the DEV Phase pipeline for a feature (frontend + backend agents per task, then qa, devops, doc-gen, then snapshot)
argument-hint: <slug> [--task T-NNN] [--yes] [--no-devops] [--no-docs] [--workflow|--native] [--all-tasks]
---

# /planr-pipeline:ship {slug …}

Orchestrates the DEV Phase for `feat-${SLUG}` (see **`procedures/ship-arguments-and-cost-gate.md`** for flag stripping rules). Generates production code from PO-Phase task files, runs the qa-agent gate, optionally generates infra and docs, then refreshes `CLAUDE.md` via the snapshot skill.

**Flags:**

| Flag | Behaviour |
|--|--|
| **`--task T-NNN`** | Run DEV + QA/doc stages only for **`id: T-NNN`** frontmatter *(validated post mode-detection)*. Forces `single-task`. |
| **`--yes`** | Skip the COST **ESTIMATE** interactive gate (**still prints** the labelled estimate block once); implies dispatch style `native`. |
| **`--no-devops`**, **`--no-docs`** | Step 4 opt-outs unchanged. |
| **`--workflow`** / **`--native`** | Pre-select the Claude Code multi-task dispatch *style* (host-scheduled DAG vs free native fan-out); skips the B.3 style prompt. Ignored on cursor/codex/unknown. |
| **`--all-tasks`** | Force `multi-task` on a host that can run parallel subagents. |

Fatal errors obey **`fatal-error-format.md`**.

**Per `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1, this command MUST NOT be auto-chained from `/planr-pipeline:plan`.** A human review step is mandatory between PO Phase and DEV Phase.

---

## Step 0 — Write snapshot sentinel

Touch `.claude/.snapshot-pending` so the Stop hook (in `${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json`) fires a reminder if this command aborts before reaching Step 5.

---

## Step 0.5 — Parse argv (`ship-arguments-and-cost-gate.md` **Phase A**)

Execute **`${CLAUDE_PLUGIN_ROOT}/procedures/ship-arguments-and-cost-gate.md` → Phase A only** before anything that needs **`${SLUG}`**.

---

## Step 1 — Mode detection + input validation

### 1a — Detect planr spec mode

Run procedure: `${CLAUDE_PLUGIN_ROOT}/procedures/mode-detection.md` **using `${SLUG}` as the slug input variable** _(equivalent historically to stripping feature token from `$ARGUMENTS`)._ After it executes, `MODE` and (for spec-driven mode) `SPEC_DIR` / `FEAT_DIR` are bound. The procedure also handles the self-heal-on-missing-`stack.md` pathway and the path-resolution table.

### 1b — Validate required inputs

The procedure file at `${CLAUDE_PLUGIN_ROOT}/procedures/mode-detection.md` (section "Required inputs (per command) → /ship") covers the required-inputs validation for both modes. The procedure's "Conditional / recommended inputs" section also covers the design-spec.md / `output/db/schema.json` warnings for both modes. After it returns, continue **Step 1.5**.

### 1.5 — TASK binding re-check + COST ESTIMATE (**Phase B**)

Re-enter **`procedures/ship-arguments-and-cost-gate.md` → Phase B** (TASK existence validation + COST block + the **B.3 AskUserQuestion confirmation gate** — a clickable spend-confirmation prompt, never a typed magic word, that on Claude Code multi-task also offers the **free-native vs structured-workflow** dispatch choice; `--yes` skips it and defaults to `native`).

### 1.6 — Bind run manifest path *(append-only `.run-manifest.jsonl`, SPEC-008)*

After `MODE` / `SPEC_DIR` / `FEAT_DIR` are bound:

| Mode | Manifest (`MANIFEST_PATH`) |
|---|---|
| Spec-driven | `<SPEC_DIR>/.run-manifest.jsonl` |
| Default | `output/feats/feat-${SLUG}/.run-manifest.jsonl` |

**Contract:** Append **one JSON object per newline** (JSONL). Validate each record against **`${CLAUDE_PLUGIN_ROOT}/schemas/v1.0.0/run-manifest.schema.json`**. **Append-only** — never truncate the file or erase prior rows.

Records include **`stage`**, **`agent`** (slug or **`null`**), **`started_at`/`ended_at`**, **`files_written`/`files_modified`** (arrays of repo-relative POSIX paths touched in that slice), **`exit_status`** (**`success`|`failure`|`skipped`**), **`error_summary`** (**`null` unless `failure`**), optional **`cost_hint`** surfaced read-only via **`/planr-pipeline:status`**.

Emit at minimum:

1. **`ship.bootstrap`** when Phase B clears entry into DEV (*`agent: null`* — starts last-run partitioning for **`/planr-pipeline:status`**);  
2. **`ship.phase1`** after §**1b** inputs validate;  
3. **`ship.task:<TASK_YAML_ID>`** per dispatched task (**success OR** `tasks/T-<YAML_ID>-error-report.md` after **R6**);  
4. **`qa-gate`**, **`devops-bundle`**, **`doc-gen-bundle`** (**`exit_status: skipped`** when **`--no-devops`/`--no-docs` applies), **`snapshot`**, **`marker-write`**.

Empty path lists ⇒ **`[]`**.

---

## Step 1.7 — Runtime adapter detection (`RUNTIME` binding)

Bind `RUNTIME` once, before any subagent dispatch decision. The detection is read-only and order-sensitive:

1. **`claude-code`** — set if `${CLAUDE_PLUGIN_ROOT}` resolves to a real path (the substitution is unique to Claude Code's plugin loader).
2. **`cursor`** — set if `.cursor/rules/planr-pipeline.mdc` exists at the project root (Cursor adapter rules generated by `planr rules generate --target cursor --scope pipeline`).
3. **`codex`** — set if `AGENTS.md` at the project root contains the literal token `## Planr Pipeline Orchestration` (Codex adapter section produced by `planr rules generate --target codex --scope pipeline`).
4. **`unknown`** — set if none of the above match.

`RUNTIME` is consumed by Step 1.8 (dispatch mode) and Step 6 (`runtime` field of the `.pipeline-shipped` marker). Append a manifest record `{ stage: "ship.runtime-detected", agent: null, exit_status: "success", cost_hint: "runtime=${RUNTIME}" }`.

---

## Step 1.8 — Dispatch mode + style

### Dispatch mode (`DISPATCH_MODE`)

`multi-task` is the **default and the design center** on Claude Code: each subagent gets fresh, manifest-isolated context, so the orchestrator can fan out **every ready task at once** with no cumulative-context bias. The narrow modes exist ONLY for runtimes that carry one continuous session (where prior tasks' context biases the model toward "this looks already shipped, write a status rollup" instead of generating code — per-invocation isolation is the only reliable mitigation).

| `RUNTIME` | `DISPATCH_MODE` | Why |
|---|---|---|
| `claude-code` | **`multi-task`** | Manifest-isolated subagents → **fan out every eligible task in one turn. Dispatch wide; this is the intended operating point.** |
| `cursor` / `codex` | `per-task` | One continuous session; per-invocation isolation prevents the verification-rollup failure mode. |
| `unknown` | `per-task` | Fail safe — an unidentified host may be single-session. |

`--all-tasks` forces `multi-task` on any host that can run parallel subagents. If `$SHIP_TASK_ID` was bound (`--task T-NNN`), `DISPATCH_MODE` is forced to `single-task` (already a single-task invocation).

### Dispatch style (`DISPATCH_STYLE`) — Claude Code `multi-task` only

When `RUNTIME == claude-code` AND `DISPATCH_MODE == multi-task`, bind `DISPATCH_STYLE` — *how* the wide fan-out is executed. Both run the same agents on the shared tree, honor `dependsOn`, and keep the orchestrator as the single writer of status + manifest; they differ only in who guarantees the schedule:

| `DISPATCH_STYLE` | Meaning |
|---|---|
| **`native`** (default) | The orchestrator emits one `Agent` call per eligible task directly and fans out as it sees fit. Model-driven dispatch — maximum flexibility, zero new machinery. |
| `workflow` | The orchestrator drives the **Workflow tool**: it declares the `dependsOn` DAG and the host schedules the fan-out **deterministically and replayably** (runtime-enforced, not model-emitted). Same agents, same single-writer bookkeeping committed by the orchestrator from the returned per-node results. |

Bind from Phase-A flags (`--native` / `--workflow`) when present; otherwise the **Step 1.5 / B.3 gate** offers the choice as a clickable option (`--yes` ⇒ `native`). On `cursor` / `codex` / `unknown`, `DISPATCH_STYLE` is **not bound** and the choice is suppressed — neither a Workflow tool nor safe in-session fan-out exists there, so both styles collapse to the per-task resume loop.

Append manifest `{ stage: "ship.dispatch-style-selected", agent: null, exit_status: "success", cost_hint: "style=<native|workflow|n/a>" }`.

**Neither mode nor style is a width knob.** On `multi-task`, width is exactly "every eligible task" — the host's native concurrency cap is the only throttle. Do not self-limit to 1–2 agents.

---

## Step 1.9 — Project memory read

Execute `${CLAUDE_PLUGIN_ROOT}/procedures/memory-read.md`. This reads `.planr/memory.md` (if present), keyword-matches entries against each task's file lists and stack keywords, and prepares a `## Relevant Project Memory` context block to inject into agent dispatch. If the file is absent or empty, this step is a no-op.

---

## Step 2 — Dispatch the feature's tasks (feature-flat, status-driven)

**In `multi-task` mode the dispatch queue is FEATURE-FLAT: collect every task across ALL stories into one set and dispatch every eligible task together.** User-story folders are where task files *live* — they are **not** a dispatch boundary. A feature with six ready tasks across four stories is **six `Agent` calls in one turn**, not one story's two. Do not walk stories one at a time; do not stop at the Frontend‖Backend pair inside a single US — that two-agent picture is the *smallest* case, not the canonical one.

Where the task files live (read them ALL into one queue regardless of story):
- **default mode:** `output/feats/feat-${SLUG}/us-*/tasks/task-*.md`
- **spec-driven mode:** the flat `<SPEC_DIR>/tasks/T-*.md` (each carries a `storyId` linking it to its story, which does not affect dispatch order)

(`per-task` / `single-task` modes process one task per invocation — see 2b.)

### 2a — Build the dispatch queue (status-aware, across ALL stories)

Read **every** task file's frontmatter across all of the feature's stories into one flat queue, and partition by `status` (per `schemas/v1.0.0/task.schema.json`):

| Frontmatter `status` | Treatment |
|---|---|
| `done` | **Skip.** Already shipped successfully. Append manifest `{ stage: "ship.task:T-NNN", agent: null, exit_status: "skipped", error_summary: null }`. Print `↷ T-NNN — already done, skipped.` |
| `pending` | **Enqueue.** Fresh task, never attempted. |
| `in-progress` | **Enqueue + recover.** A prior run crashed mid-task. Treat as pending; if a partial output file exists from the prior attempt, log it in the dispatch context so the agent knows the prior state. |
| `blocked` | **Enqueue + retry.** A prior R6 cycle wrote `T-NNN-error-report.md`. The new attempt re-reads the report, attempts a clean fix, and either advances to `done` or stays at `blocked` with a refreshed report. |

If `$SHIP_TASK_ID` was bound during Phase A, after partitioning, narrow the queue to the single matching task (skip everything else regardless of status).

If the resulting queue is **empty** AND `$SHIP_TASK_ID` is unset:
- Skip Step 2 entirely with `✓ All tasks already done — no DEV work to dispatch.`
- Proceed to Step 3 (qa-agent verifies the existing shipped state).

### 2b — Apply `DISPATCH_MODE`

- `multi-task`: process the whole feature-flat queue this invocation via **native parallel dispatch** — see **§2b-multi** below. **Dispatch every eligible task; do not artificially limit width.** Eligible = every id in its `dependsOn` is `done`, or it declares no `dependsOn` (`dependsOn` is the ONLY hard ordering — no write-set inference, no cycle detection). Emit one `Agent` tool-call per eligible task in a single assistant turn, with **no** `isolation` field and **no** width cap. If five tasks are eligible, that is five `Agent` calls in this turn — not one or two. The host's native concurrency cap is the only throttle.
- `per-task`: process **one** task this invocation — pick the first `pending`, otherwise the oldest `blocked`. Remaining tasks stay enqueued for the next `/ship` invocation. Print at the end:

  ```
  ⏸ Task T-NNN dispatched ({success|blocked}) this invocation.
    Remaining queue: N task(s) {pending: A, blocked: B}.
    Run /planr-pipeline:ship ${SLUG} again to continue.
  ```

- `single-task`: process the targeted task. Same behavior as `per-task` but selects by ID.

> **`--all-tasks` × `DISPATCH_MODE`:** `--all-tasks` forces `DISPATCH_MODE = multi-task` (Step 1.8 override) so every eligible ready task is dispatched in one turn. There is no width knob — `--all-tasks` decides *whether* the run goes wide; the host's native concurrency cap decides *how* wide. The `per-task` and `single-task` modes always dispatch exactly one task per invocation (FR11).

### §2b-multi — Wide dispatch (`DISPATCH_MODE == multi-task` only)

Entered only when `DISPATCH_MODE == multi-task`. `per-task` / `single-task` never reach here — they fall through to **§2c** and keep their one-task-per-invocation contract (FR11).

**The default is wide, and wide is safe.** Your task decomposition already makes ready tasks write-disjoint — the specification-agent declares `dependsOn` for genuine *output* dependencies and keeps independent siblings independent — so dispatching ALL eligible tasks at once is the **expected** behavior, not a hazard to manage. The host runs them as native parallel subagents; there is no isolation layer because eligible tasks don't overlap. The single-writer bookkeeping below is a mechanical stamp-before / reconcile-after sweep — it is **not** a reason to go narrow. Full contract: `${CLAUDE_PLUGIN_ROOT}/procedures/ship-step2-dag-dispatch.md`.

**`DISPATCH_STYLE` branch (bound in Step 1.8):** `native` (default) → emit the `Agent` calls yourself, steps 1–6 below. `workflow` → drive the Workflow tool instead, **§2b-workflow**.

#### Native style

1. **Assemble the live set (feature-flat).** The Step 2a queue after `done`-skip — every `pending`/`in-progress`/`blocked` task across all stories. `in-progress` recovery and `blocked` retry from §2a still apply. Per task read `id`, `status`, `agent`, `type`, and the optional **`dependsOn`** array.

2. **Eligibility (`dependsOn`-only).** Eligible iff every id in its `dependsOn` is `done`, or it has none. **No** write-set inference, **no** cycle detection. A task with no `dependsOn` is eligible immediately, *regardless of any file overlap with a sibling*.

3. **Stamp the eligible set, then dispatch all of it in one turn.**

   ```
   stamp(E):  for each T in E → frontmatter status:in-progress, updated:<today>;
              remember started_at:<now> in memory (the manifest row is appended
              once, complete, at close-out — schema forbids interim rows)
   dispatch:  ONE assistant turn · ONE Agent call per T in E (subagent_type=<T.agent>) ·
              prompt = the §2c per-task prompt · NO `isolation` field · NO width cap.
   ```

   `stamp` is one quick batched pass over the whole eligible set — **not** a per-task gate you interleave between dispatches. Stamp them all, then emit every `Agent` call together.

4. **Roll forward — do not wait for the whole batch.** As each `Agent` returns, close its bookkeeping immediately (success → `done`; R6-exhausted → `blocked` + `T-<id>-error-report.md`) **and dispatch any task it just unblocked**. You never have to drain the current batch before starting newly-eligible dependents; width grows as dependencies clear and is never reset to a narrow wave. Continue until every task is `done` or `blocked` (a `blocked` task's dependents are unreachable — skip them).

5. **R6 per task.** Each Agent runs the R6 loop (`${CLAUDE_PLUGIN_ROOT}/docs/rules.md`) exactly as §2c step 4. One task exhausting R6 lands `blocked` and does **not** abort the run (FR14).

6. **Single-writer (mechanical, not a throttle).** Task `.md` `status` and `.run-manifest.jsonl` are written **only** by the orchestrator (FR12/FR13); subagents never write either. This owns *who writes bookkeeping*, not *how wide you dispatch* — keep it batched and out of the way of fan-out.

#### §2b-workflow — Workflow style (deterministic, host-scheduled DAG)

When `DISPATCH_STYLE == workflow`, drive the **Workflow tool** instead of hand-emitting `Agent` calls. planr **declares** the graph; the host **schedules** it. Do NOT revive a planr-side scheduler, worktrees, or waves — that machinery was deleted in SPEC-014 and must not return; determinism comes from the host's Workflow tool, not from planr.

1. **Pre-stamp EVERY feature task** (the whole live set up front — not just the first eligible set that native's per-turn `stamp(E)` covers), before authoring the workflow: for each task T → frontmatter `status: in-progress`, `updated: <today>`; remember `started_at: <now>` for each (the single complete manifest row is appended at close-out from the returned node results). Stamping all tasks up front is correct here (unlike native, which rolls forward and stamps each task just before it runs) because the whole DAG commits to run in this one orchestrator turn — a mid-workflow crash then leaves dependents at `in-progress` (which §2a recovers) rather than at `pending`, indistinguishable from never-started. The trade is intentional: in workflow style a deep dependent's `started_at` is the author-time stamp, not its true dispatch instant (acceptable — the manifest captures the run's outer timeline, and `ended_at` from the node is exact); native style keeps exact per-task `started_at` via its roll-forward stamp.
2. **Author one workflow** whose nodes are the feature's tasks and whose edges are the `dependsOn` graph (`pipeline`/`parallel` so independent tasks run concurrently and a dependent waits on its dependency's node). Each node dispatches the task's agent with the §2c per-task prompt and **returns a structured result**: `{ id, status: done|blocked, ended_at, files_written[], files_modified[], error_summary?, errorReport? }` — where on `blocked`, `error_summary` is the one concise line for the manifest and `errorReport` is the FULL `${CLAUDE_PLUGIN_ROOT}/templates/error-report.md`-shaped body (per-pass attempt log + file lists + suspected root cause), so the orchestrator can write the report verbatim. Nodes do **NOT** write status or manifest themselves.
3. **Commit bookkeeping from the returned results** (orchestrator, single-writer): per node result, close the task frontmatter (`done`, or `blocked` + write `T-<id>-error-report.md` verbatim from the node's `errorReport`) and append its single complete manifest record (`started_at` from step 1's stamp time, `ended_at` from the node, terminal `exit_status`, `files_written`/`files_modified` populated, `error_summary` from the node on failure). FR12/FR13 hold — the schedule is the host's, the writes are still the orchestrator's, and every record carries `started_at` (step 1) + `ended_at` (the node).

**Termination (both styles).** When the queue drains, fall through to **Step 3 (QA Gate)** — it audits every task that ran this invocation (NFR1; wide dispatch speeds DEV, it never weakens QA).

### 2c — Per-task prompt + close-out (the template, not the iteration order)

This is the per-task state machine — the prompt body and close-out applied to **each** dispatched task. It does **not** govern iteration order: in `multi-task` mode §2b-multi dispatches all eligible tasks at once (per-task / single-task modes apply this to their one task). Read it as "what each task's dispatch looks like," not "do these one at a time."

1. **Read** the task file frontmatter. Capture `id`, `type`, `agent`, current `status`, `updated`.
2. **Write** updated frontmatter: `status: in-progress`, `updated: <today's ISO date>`. Remember `started_at: <now>`; the task's single manifest record is appended complete at close-out (step 5).
3. **Read** the task's `Type` field:
   - `UI` → delegate to **frontend-agent** subagent (Opus 4.8)
   - `Tech` → delegate to **backend-agent** subagent (Opus 4.8) or **db-agent** if the agent field says so
4. **Apply the 3-iteration correction loop** (R6 — `${CLAUDE_PLUGIN_ROOT}/docs/rules.md`):
   - Iteration 1: direct fix on build/test failure
   - Iteration 2: re-read task spec + design-spec/schema, fix holistically
   - Iteration 3: minimal safe fix, flag remaining issues
5. **Close out the task** by writing the final `status` to the task's frontmatter:
   - **Success:** `status: done`, `updated: <today>`. Append the task's single manifest record: `started_at` (from step 2), `ended_at: <now>`, `exit_status: "success"`, `files_written + files_modified` populated, `error_summary: null`.
   - **R6 failure (3 iterations exhausted):** `status: blocked`, `updated: <today>`. Write `${CLAUDE_PLUGIN_ROOT}/templates/error-report.md`-shaped content to `tasks/T-NNN-error-report.md` (same folder as task markdown — **never** the legacy singleton `tasks/error-report.md`). Append the task's single manifest record: `started_at` (from step 2), `ended_at: <now>`, `exit_status: "failure"`, `error_summary: <one concise line>`. Continue to the next task in the queue (do not abort the run unless all queued tasks are blocked).
   - **Default mode:** report path is `output/feats/feat-${SLUG}/us-{N}/tasks/T-NNN-error-report.md`
   - **Spec-driven mode:** report path is `<SPEC_DIR>/tasks/T-NNN-error-report.md`

### 2d — Status invariants (never violate)

- A task whose frontmatter says `status: done` is **canonically shipped**. Step 2 never re-dispatches it. To force re-attempt, manually flip it back to `pending` (or `blocked` if you want the agent to read the prior error report).
- A task whose frontmatter says `status: in-progress` AND has no `T-NNN-error-report.md` companion AND no `done` close-out has crashed — Step 2a recovers it.
- The `updated:` field is bumped on every status transition. The manifest captures the per-attempt timeline; the frontmatter captures the current state. Both are needed.
- In `multi-task` mode, **ALL eligible tasks across ALL stories run in parallel** — not just the Frontend/Backend pair inside one US. The FE‖BE-within-a-US case is the *smallest* instance of this, never the ceiling. (Per-task / single-task modes are sequential by definition.)

---

## Step 3 — QA Gate (Step 3.5)

After all dispatched US/task paths complete *(or halt after per-task **`T-*-error-report.md`** handoffs)*, delegate to the **qa-agent** subagent.

When **`--task`** targeted a subset, qa-agent **still runs**, but verifies **only** tasks that executed this turn **plus any companion tasks whose outputs are mandatory for local Build/Test coherence** *(default: strict subset flagged by orchestrator).* At minimum **every dispatched task MUST be audited.**

The qa-agent verifies, for each **in-scope** task:
- All "Create" files exist
- All "Modify" files were updated (and only as described)
- All "Preserve" files are unchanged (git diff vs base)
- Tests exist and pass (`BuildCommand` + `TestCommand` from stack.md)
- DoD checklist items are satisfied

If QA fails: flag the failure in summary; **still proceed to Step 5 snapshot** so state is recorded, but skip DevOps and Doc-Gen agents until the underlying task is fixed.

---

## Step 4 — DevOps + Doc-Gen Agents (Step 3.5, parallel, optional)

These run only if QA passes **and** `$SHIP_SKIP_DEVOPS` / `$SHIP_SKIP_DOCS` booleans *(from Phase A bindings)* honor these opt-outs individually.

- Delegate to the **devops-agent** subagent — generates `docker-compose.yml`, `.env.example`, Dockerfiles, and CI config matching the stack. Per non-goals: this subagent **does NOT deploy** (enforced at the tool layer — the agent has no Bash access).
- Delegate to the **doc-gen-agent** subagent — writes `Docs/feat-${SLUG}/` from the US, tasks (+ execution notes when `--task` ran), and generated source code *(doc-gen ALWAYS runs unless `--no-docs`; targeted ship still owes updated docs).* 

---

## Step 5 — Snapshot

Refresh `CLAUDE.md` at the project root with the current project state. Read the template at `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md.tpl` and write a populated copy. Capture, in this order:

1. **Project Identity** — `AppName`, `Version`, `DatabaseType`, `Framework`, `Language` from `input/tech/stack.md`. Include the generation timestamp (ISO 8601 UTC).
2. **Phase Status** — scan filesystem to determine actual state:
   - DB Prep: `output/db/schema.json` exists and non-empty?
   - PO Phase: count US + task files under `output/feats/feat-*/` (default mode) or `.planr/specs/SPEC-*/` (spec-driven mode)
   - DEV Phase: count generated source files under `src/` for the feature
3. **Feature Registry** — for each feature folder:
   - Count US directories
   - Count task files
   - Detect presence of `design-spec.md`
   - Read `status` from US frontmatter
4. **Active Agents** — list all agents in `${CLAUDE_PLUGIN_ROOT}/agents/*.md`, with model assignments and tool restrictions.
5. **Build Log** — append the latest build / test outcomes (from this `/ship` run). **Append-only — never truncate prior entries.**
6. **Known Issues / Escalations** — recursively scan **`T-*-error-report.md`** beside task trees (never the legacy singleton `error-report.md`). For each failure handoff enumerate: feature, US, task id, agent role, suspected root cause, remediation bullet.
7. **Stack Summary** — embed full content of `input/tech/stack.md`.

### Snapshot integrity rules

- ✅ Always write a complete, valid `CLAUDE.md` — never partial
- ✅ Always include the generation timestamp
- ✅ Preserve existing build log entries (append only)
- ✅ If a scan section fails, write `[scan error]` rather than leaving it empty
- ❌ Never delete `CLAUDE.md`
- ❌ Never leave `CLAUDE.md` in a partially-written state

### Coexistence with planr-managed `CLAUDE.md`

Some projects use **planr CLI**'s agile-planning-protocol guide as their `CLAUDE.md` (planr generates one too, with its own Context-Gathering Protocol). If the existing `CLAUDE.md` opens with planr's signature header (`> Generated by OpenPlanr` or contains `## Context-Gathering Protocol`), do **not** overwrite. Instead:
- Skip the snapshot write
- Print a clear notice: *"CLAUDE.md is planr-managed; pipeline state recorded via `.pipeline-shipped` marker (Step 5.5) and qa-report.md."*
- Continue to Step 5.5

This preserves the user's existing planr context without losing pipeline audit trail (which lives in `.pipeline-shipped` + `qa-report.md`).

After writing (or skipping), remove the `.claude/.snapshot-pending` sentinel.

The Stop hook in `${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json` is a backup: if this command aborts before this step, the hook prints a reminder.

---

## Step 5.5 — Write the `.pipeline-shipped` marker

After Step 5 succeeds, write a marker file recording the pipeline run.

**Default mode:** `output/feats/feat-${SLUG}/.pipeline-shipped`
**Spec-driven mode:** `<SPEC_DIR>/.pipeline-shipped`

Contents (YAML):

```yaml
shipped_at: "<ISO 8601 UTC timestamp>"
pipeline_version: "<from ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json>"
runtime: "<claude-code | cursor | codex | unknown>"   # ${RUNTIME} from Step 1.7 (unknown = fail-safe)
mode: "<default | spec-driven>"
feature: "${SLUG}"
tasks_executed: <integer>
tasks_failed: <integer>
qa_gate_status: "<passed | failed | skipped>"
duration_seconds: <integer>
agents_invoked:
  - frontend-agent          # only list agents that actually ran this run
  - backend-agent
  - qa-agent
  - devops-agent
  - doc-gen-agent
devops_status: "<generated | skipped>"
docs_status: "<generated | skipped>"
snapshot_status: "<refreshed | skipped>"
dispatch_style: "<native | workflow>"   # ${DISPATCH_STYLE}; OMIT the key entirely on per-task runtimes / single-task / when unbound
error_reports:               # paths to any T-<NNN>-error-report.md files; empty list if none
  - <path>
```

If Step 5 (snapshot) failed but tasks shipped, still write the marker with
`snapshot_status: skipped` so the partial-success state is recorded.

---

## Step 6 — Print summary

```
✓ DEV Phase complete for feat-${SLUG}
  Mode:            <default | spec-driven>
  Output dir:      <output/feats/feat-${SLUG}/ | .planr/specs/SPEC-NNN-${SLUG}/>
  Tasks succeeded: X / Y
  Tasks failed:    Z (see T-<NNN>-error-report.md paths)
  QA gate:         <passed | failed>
  DevOps config:   <generated | skipped>
  Docs:            <generated | skipped>
  CLAUDE.md:       refreshed
  Marker:          <output dir>/.pipeline-shipped     ← proof of pipeline execution
```

If spec-driven mode was active, the spec's frontmatter `status` is updated to `in-pipeline` while ship runs and to `done` on full success.

If any task failed, enumerate every **`T-<NNN>-error-report.md`** path produced.

---

## Failure modes

| Condition | Action |
|-----------|--------|
| feat folder missing | Abort, suggest `/planr-pipeline:plan ${SLUG}` |
| No tasks | Abort, suggest re-run of PO Phase |
| Single task fails 3x | Continue with other tasks, surface in summary |
| All tasks fail | Skip QA + DevOps + Doc-Gen; still run snapshot to record state |
| QA gate fails | Skip DevOps + Doc-Gen; still run snapshot |

---

*Reads (default mode): `output/feats/feat-{name}/`, `stack.md`, `schema.json`, `design-spec.md`*
*Reads (spec-driven mode): `.planr/specs/SPEC-NNN-{slug}/`, `stack.md`, `schema.json`, `design-spec.md`*
*Writes: `src/features/{name}/`, tests, `docker-compose.yml` (optional), `Docs/` (optional), `CLAUDE.md` (via snapshot)*
*Per `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1: must be invoked manually after human review of PO Phase output.*

**Bridge to planr CLI:** in spec-driven mode, this command reads/writes `.planr/specs/` directly — no conversion. The planr CLI is the *authoring* surface; planr-pipeline is the *executor*.
