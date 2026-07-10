---
description: Run the PO Phase pipeline for a single feature (db-agent → designer-agent → specification-agent)
argument-hint: <slug> [brief …] [--dry-run]
---

# /planr-pipeline:plan {feature-name}

Orchestrates the PO Phase for `feat-{slug}` (first token after flag stripping — see **`plan-step0-preflight.md`**). Decomposes a functional spec into User Stories + Tasks, optionally with a design spec from PNG mockups and a DB schema snapshot.

**Flags:** **`--dry-run`** — executes read-only **`plan-dry-run-preview.md`** immediately after **`plan-step0-preflight.md`** § **0.5** and **STOP**s *(no Phase B→D; no PO subagents; no orchestration writes in that invocation beyond anything already flushed before § 0.5b).* Fatal errors obey **`fatal-error-format.md`** (two-line).

**The PO Phase NEVER auto-chains to the DEV Phase.** This command stops after writing US/task files. A human must review the generated stories + tasks before invoking `/planr-pipeline:ship $ARGUMENTS`. This is enforced by `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1.

---

## ORCHESTRATION CONTRACT (read this first, mandatory)

This command has **EXACTLY** these phases, in order:

| Phase | Purpose | Outputs |
|---|---|---|
| **A — Pre-flight** | Parse args, set up project state | `.planr/config.json`, `input/tech/stack.md` (when applicable) |
| **B — Mode + spec body** | Detect mode, author spec body from BRIEF | `<SPEC_DIR>/SPEC-NNN-${SLUG}.md` with substantive content |
| **C — Subagent dispatch** | Run db-agent → designer-agent → specification-agent | DB snapshot, design-spec.md, US/Task files |
| **D — R1 gate (stop)** | Verify completion + print summary + stop | Console summary, NO `/ship` chain |

### Termination rule

**You are NOT done when a Bash command succeeds. You are NOT done when scaffolding completes. You are NOT done when bootstrap files are written.**

You are done ONLY when the **Completion Contract** in `${CLAUDE_PLUGIN_ROOT}/procedures/plan-steps-2-through-completion.md` is satisfied — every checkbox verified on disk.

If you cannot complete a phase (subagent fails, scaffolder fails, missing dep), abort with a clear error identifying which phase failed and what state was reached. **Do not print success.** Do not silently exit.

### Task tracking is mandatory

At the **start** of execution, immediately track these 4 phases with your runtime's task tool:

1. `Phase A — Pre-flight (state strategy + bootstrap)`
2. `Phase B — MODE binding (**mode-detection.md**) + author spec shell`
3. `Phase C — Subagent dispatch (db, designer, specification)`
4. `Phase D — Verify completion contract + print summary`

Use the current Claude Code task tools (**`TaskCreate`** one per phase, **`TaskUpdate`** to advance status). On Claude Code **< 2.1.142** the tool is `TodoWrite` (deprecated and disabled by default in 2.1.142+); on Cursor/Codex or any runtime without a task tool, track the phases inline in your responses. Mark each item `in_progress` before starting it, `completed` only after on-disk verification of its outputs (per the per-phase verification gates in the procedure files below). This is non-negotiable — without it, the model loses track on long executions and silently abandons mid-task. The tracker is a progress aid; if it is unavailable, still verify every phase on disk.

When **`plan-step0-preflight.md`** terminates via **`§ 0.5b`** (`--dry-run`), mark item **1** `completed`, **2–4** `cancelled` (`dry-run exit`).

### After every Bash tool call, ask: "did this complete the phase, or just one step?"

Bash success is a step result, not a phase result. After every successful Bash command, return to the strategy you're executing and continue with the next sub-step. Only the Completion Contract can mark the command done.

---

## Step 0 — Pre-flight (state machine)

**Execute** `${CLAUDE_PLUGIN_ROOT}/procedures/plan-step0-preflight.md` from start to finish. That procedure sanitizes `$ARGUMENTS`, parses `SLUG` + `BRIEF`, runs **`### 0.4`–`### 0.5`** (signals + the coverage table below), invokes **exactly one** `${CLAUDE_PLUGIN_ROOT}/procedures/strategy-*.md` file (**`### 0.6`**), and ends with the **Phase A** verification gate. Do not skip that gate.

### Five-strategy decision matrix (coverage map)

| `HAS_PLANR` | `HAS_PACKAGE_JSON` | `BRIEF_STACK` | Strategy |
|---|---|---|---|
| ✅ | any | any | `CONTINUE` |
| ❌ | ✅ | any | `BOOTSTRAP_ONLY` |
| ❌ | ❌ | `node` | `SCAFFOLD_NODE` |
| ❌ | ❌ | `non-node` | `ASK_MANUAL` |
| ❌ | ❌ | `none` | `ASK_STACK` |

Five rows. Five states. Mutually exclusive. Total coverage.

---

## Step 1 — MODE binding + input validation

**Execute** `${CLAUDE_PLUGIN_ROOT}/procedures/plan-step1-mode-and-spec.md`. This binds `MODE` / `SPEC_DIR` via **`mode-detection.md`**, validates inputs, optionally auto-scaffolds the spec shell, and ends with the **Phase B** verification gate.

### Step 1.1 — Missing-design nudge (printed, non-blocking)

After Step 1 validation, **execute** `${CLAUDE_PLUGIN_ROOT}/procedures/design-detect-nudge.md`. If the feature looks UI-facing but has no design yet, it prints a one-line recommendation to run `/planr-pipeline:design {slug}` first. It is **stdout only** — no `AskUserQuestion`, no branch, no effect on `--dry-run`. `/plan` proceeds normally whether or not the nudge fires; `/plan` never invokes `/design` (R1 design corollary).

---

## Step 1.5 — Initialize project memory + read clarifications

**Execute** `${CLAUDE_PLUGIN_ROOT}/procedures/memory-read.md`. This ensures `.planr/memory.md` exists (creates from template if absent) and keyword-matches relevant entries for the specification-agent's context.

Then **execute** `${CLAUDE_PLUGIN_ROOT}/procedures/read-clarifications.md`. If a prior `/plan` run emitted `clarifications.md` and the PO has filled in `**Resolved:**` answers, this procedure parses them and injects the answers into the specification-agent's dispatch context. If no clarifications file exists, this step is a no-op.

---

## Step 2 — Subagents + Completion Contract + STOP

**Execute** `${CLAUDE_PLUGIN_ROOT}/procedures/plan-steps-2-through-completion.md`. This covers Step 2 subagent sequencing, the Phase C verification gate, the Completion Contract, the success summary, **STOP**, and **Failure modes**.

### Step 0.2 — Entity scaffold (optional; **not** part of the default Step 2 chain)

After **`output/db/schema.json`** exists, if the Tech Lead needs ORM entities / DbContext (or stack-equivalent) under **`output/src/`** *before* DEV tasks: dispatch **`entity-scaffold-agent`** — **`${CLAUDE_PLUGIN_ROOT}/agents/entity-scaffold-agent.md`** (`claude-sonnet-5`). **Do not** use **`backend-agent`** for Step 0.2 — **`backend-agent`** is **Step 3** Tech task codegen only (`/planr-pipeline:ship`).

---

### Procedure index (thin orchestrator)

| Piece | Procedure file |
|---|---|
| Step 0 + Phase A | `procedures/plan-step0-preflight.md` |
| Dry-run preview | `procedures/plan-dry-run-preview.md` *(§ 0.5b only)* |
| Fatal UX | `procedures/fatal-error-format.md` |
| Strategies | `strategy-continue.md`, `strategy-bootstrap-only.md`, `strategy-scaffold-node.md`, `strategy-ask-manual.md`, `strategy-ask-stack.md` |
| Common (invoked by 2+ strategies) | `write-planr-dirs.md`, `author-stack-from-brief.md`, `stage-design-assets.md`, `restore-design-assets.md` |
| Step 1 + Phase B | `procedures/plan-step1-mode-and-spec.md` |
| Mode detection (shared with `/ship`) | `procedures/mode-detection.md` |
| Auto-scaffold spec shell (Step 1b) | `procedures/auto-scaffold-spec.md` |
| Step 2 → finish | `procedures/plan-steps-2-through-completion.md` |

---

*Reads: spec, stack, ui PNGs, db env vars (see procedure bodies)*  
*Writes (default mode): `output/db/schema.json`, `output/feats/feat-{name}/`*  
*Writes (spec-driven mode): `output/db/schema.json`, `.planr/specs/SPEC-NNN-{slug}/{design,stories,tasks}/`*  
*Does NOT chain to DEV Phase — pipeline stops here for human review (`${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1).*

**Bridge to planr CLI:** when `.planr/config.json` declares spec mode, the pipeline reads from `.planr/specs/` directly with no conversion. See `${CLAUDE_PLUGIN_ROOT}/README.md` for the integration story.
