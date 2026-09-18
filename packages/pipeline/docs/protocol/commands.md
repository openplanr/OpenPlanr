# OpenPlanr Protocol — Commands (v1.0.0)

> `PLAN` and `SHIP` defined as runtime-agnostic command contracts. Each runtime
> adapter exposes them through native commands, skills, or a machine-readable handoff.

## R1 — user-directed workflow continuity

The user's request controls the workflow boundary. A planning-only request stops
after the plan. An implementation request continues through implementation and
the relevant checks.

Ask only when a consequential product choice cannot be inferred. Keep the work
within the requested scope.

## PLAN — PO Phase orchestration

### Inputs

- `feature` — slug (no `feat-` or `spec-` prefix)
- Project root with one of:
  - **Default mode:** `input/specs/spec-{feature}.md` (Tech Lead-authored)
  - **Spec-driven mode:** `.planr/specs/SPEC-NNN-{feature}/SPEC-NNN-{feature}.md` (planr CLI- or pipeline-scaffolded)
- `input/tech/stack.md` (project tech stack)
- Optional: PNGs for designer-agent
- Optional: DB env vars for db-agent
- Optional flag: **`--dry-run`** — read-only diagnostics (strategy + planned PO subagents). MUST NOT mutate disk as part of that branch beyond already-flushed scaffolding, and MUST NOT dispatch db/designer/spec agents.

### Mode detection

1. Read `.planr/config.json`. If `idPrefix.spec` is set, **spec-driven mode**.
2. In spec-driven mode, scan `.planr/specs/` for a directory matching `^[A-Z]+-\d{3}-{feature}$`. First match wins.
3. Otherwise, **default mode** (output goes to `output/feats/feat-{feature}/`).

### Validation

If required inputs are missing:

- **Default mode + missing spec:** abort with creation guidance.
- **Default mode + missing stack.md:** abort with template-copy guidance.
- **Spec-driven mode + missing spec body:** **auto-scaffold** the spec shell (config.json + directory + placeholder body), then abort with edit-and-rerun message.
- **Spec-driven mode + missing stack.md:** **auto-heal** by copying the stack template, then abort with edit-and-rerun.

Auto-scaffolding and auto-healing produce no AI calls and no decomposition — they only set up state. Decomposition runs on the next invocation.

### Orchestration

1. **db-agent** (conditional) — if `DatabaseType` is set in stack.md AND DB env vars present AND `output/db/schema.json` is missing or stale.
2. **designer-agent** (conditional) — if PNGs resolve via:
   - **Default mode:** `UIFiles:` block in spec → `input/ui/feat-{feature}/*.png` → `input/ui/*.png`
   - **Spec-driven mode:** `<SPEC_DIR>/design/*.png`
3. **specification-agent** (always, with spec-mode skip optimization) — if spec-driven mode AND stories already exist (the `planr-plan` skill has already decomposed it), skip; otherwise decompose.

### Output

- **Default mode:** `output/feats/feat-{feature}/us-{N}/us-{N}.md` and `tasks/task-{M}.md`
- **Spec-driven mode:** `<SPEC_DIR>/stories/US-NNN-{slug}.md` and `<SPEC_DIR>/tasks/T-NNN-{slug}.md`

### Exit

Print a summary including mode, output directory, story count, task count, key
decisions, and verification strategy. Stop for a planning-only request; continue
into implementation for an implementation request.

### Failure modes

| Condition | Action |
|---|---|
| Spec missing (default) | Abort with creation guidance |
| stack.md missing (default) | Abort with template-copy guidance |
| db-agent fails (connection) | Continue without schema, flag in summary |
| designer-agent fails (corrupt PNG) | Continue without design-spec, flag |
| specification-agent fails | Abort, surface error |

## SHIP — ordinary local implementation

### Inputs

- `feature` slug and optional **`--task T-NNN`** bounded selector.
- Project root with PO-phase outputs (US + Task files)
- `input/tech/stack.md` with `BuildCommand`, `TestCommand`, `LintCommand`
- An implementation request or exact prepared task.

### Validation

- Feature root exists (mode-appropriate path)
- ≥1 US file
- ≥1 Task file
- `input/tech/stack.md` exists (auto-heal in spec-driven mode if missing)

### Work

1. Read the request, repository instructions, relevant code and tests, and any
   useful plan, specification, story, or task.
2. Let the coding runtime choose tools, subagents, edit order, debugging method,
   and dependency waves. OpenPlanr supplies context; it does not supervise the
   agent through a parallel state machine.
3. Verify in proportion to risk and acceptance criteria. Fix relevant failures
   directly while the observed results support meaningful progress.
4. Update applicable task or specification status after verification and record
   deliberately deferred work so it is not lost.

### Output

- Updated `src/` (or feature subdir, depending on stack)
- Important changed files, exact checks and results, and any remaining or
  deliberately deferred item.

### Exit

Lead with what now works, then report files and verification concisely.

### Failure modes

| Condition | Action |
|---|---|
| Feat folder/spec dir missing | Abort, suggest PLAN first |
| No tasks | Abort, suggest re-run PLAN |
| A relevant check fails | Diagnose and fix while the result supports meaningful progress |
| A genuine impasse remains | Report the blocker, observed error, and smallest useful next action |

### Explicit release-candidate tooling

Low-level `prepare-ship`, `start-ship`, `advance-ship`, `run-ship-gates`,
`finalize-ship`, and `reopen-ship` actions remain available for an explicitly
requested auditable release candidate. Their integrity records are not loaded
by normal Plan or Ship skills and do not govern ordinary coding.

## STATUS — read-only rollup

### Inputs

- `feature` slug (same as PLAN/SHIP)
- `.pipeline-shipped` *(optional — may be absent pre-SHIP)*

### Behaviour

- Runs **Mode detection** identical to PLAN/SHIP.
- Prints a summary table covering **US/task counts**, **last ship timestamps** (zeros when untouched), **`tasks_*` totals from marker when present**, and **count of `T-*-error-report.md`** handoffs.
- NEVER mutates files.

---

## Per-runtime invocation

| Runtime | PLAN invocation | SHIP invocation | STATUS invocation |
|---|---|---|---|
| **Claude Code (canonical)** | `/planr:plan {feature}` | `/planr:ship {feature}` | `/planr:status {feature}` |
| **Cursor** | User says `plan {feature}` (or "decompose {feature}") and the canonical generated rule routes PLAN | User says `ship {feature}` and the generated Ship rule provides context | User says `status {feature}` |
| **Codex** | `$planr-plan` or router | `$planr-ship` or router | Skills call the portable engine and use native subagents when available |

In all three runtimes, planning requests return planning artifacts and
implementation requests continue through the relevant code changes and checks.

## See also

- `spec-artifacts.md` — what PLAN writes and SHIP reads
- `agent-roles.md` — the 9 roles PLAN and SHIP orchestrate
- `runtime-adapters.md` — per-runtime command surface details
- `../rules.md` — full rule set including R1

---

*OpenPlanr Protocol v1.0.0 — command contracts.*
