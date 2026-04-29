# OpenPlanr Protocol — Commands (v1.0.0)

> `PLAN` and `SHIP` defined as runtime-agnostic command contracts. Each runtime adapter exposes them via its native command surface (Claude Code slash commands, Cursor rule keywords, Codex persona triggers).

## Hard rule R1 (normative)

**The PLAN command MUST NOT auto-chain to the SHIP command.** Two separate user invocations are required. The phase boundary is a mandatory human review gate. Any runtime adapter that auto-chains is non-conformant.

This rule is the differentiator of the OpenPlanr workflow. It is the reason the pipeline exists. Runtimes that cannot prevent auto-chaining at the runtime level MUST prevent it at the prompt level.

## PLAN — PO Phase orchestration

### Inputs

- `feature` — slug (no `feat-` or `spec-` prefix)
- Project root with one of:
  - **Default mode:** `input/specs/spec-{feature}.md` (Tech Lead-authored)
  - **Spec-driven mode:** `.planr/specs/SPEC-NNN-{feature}/SPEC-NNN-{feature}.md` (planr CLI- or pipeline-scaffolded)
- `input/tech/stack.md` (project tech stack)
- Optional: PNGs for designer-agent
- Optional: DB env vars for db-agent

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
3. **specification-agent** (always, with spec-mode skip optimization) — if spec-driven mode AND stories already exist (i.e. `planr spec decompose` has run), skip; otherwise decompose.

### Output

- **Default mode:** `output/feats/feat-{feature}/us-{N}/us-{N}.md` and `tasks/task-{M}.md`
- **Spec-driven mode:** `<SPEC_DIR>/stories/US-NNN-{slug}.md` and `<SPEC_DIR>/tasks/T-NNN-{slug}.md`

### Exit

`STOP` after specification-agent completes. Print a summary including mode, output dir, US count, task count. Tell the user to review and explicitly invoke SHIP next.

### Failure modes

| Condition | Action |
|---|---|
| Spec missing (default) | Abort with creation guidance |
| stack.md missing (default) | Abort with template-copy guidance |
| db-agent fails (connection) | Continue without schema, flag in summary |
| designer-agent fails (corrupt PNG) | Continue without design-spec, flag |
| specification-agent fails | Abort, surface error |

## SHIP — DEV Phase orchestration

### Inputs

- `feature` — same slug as used for PLAN
- Project root with PO-phase outputs (US + Task files)
- `input/tech/stack.md` with `BuildCommand`, `TestCommand`, `LintCommand`

### Validation

- Feature root exists (mode-appropriate path)
- ≥1 US file
- ≥1 Task file
- `input/tech/stack.md` exists (auto-heal in spec-driven mode if missing)

### Orchestration

1. **Iterate User Stories topologically.** For each story, dispatch its tasks:
   - `Type: UI` → `frontend-agent`
   - `Type: Tech` → `backend-agent`
   - Tasks within the SAME US may run in parallel.
2. **3-iteration correction loop per task** (rule R6):
   - Iter 1: direct fix on build/test failure.
   - Iter 2: re-read task spec + design-spec/schema, fix holistically.
   - Iter 3: minimal safe fix, flag remaining.
   - On 3rd failure: write `error-report.md` to the task's directory, STOP that task, continue with independent tasks.
3. **qa-agent gate** — verify Create/Modify/Preserve lists, build, test, DoD. If failed: skip Step 4 + 5; still run Step 5 snapshot.
4. **devops-agent + doc-gen-agent** (parallel, optional) — run only if QA passed.
5. **Snapshot.** Refresh CLAUDE.md (or coexist with planr-managed CLAUDE.md). 7 capture sections: Project Identity, Phase Status, Feature Registry, Active Roles, Build Log (append-only), Known Issues, Stack Summary.
6. **`.pipeline-shipped` marker** (Step 5.5) — write YAML proof of execution. Required schema in `spec-artifacts.md`.

### Output

- Updated `src/` (or feature subdir, depending on stack)
- `qa-report.md` (audit trail of Create/Modify/Preserve verification)
- `Docs/feat-{feature}/` (if doc-gen-agent ran)
- `docker-compose.yml`, `.env.example`, CI workflow stubs (if devops-agent ran)
- Refreshed `CLAUDE.md` (or skipped if planr-managed)
- `.pipeline-shipped` marker

### Exit

Print summary including: mode, tasks succeeded, tasks failed, qa status, devops status, docs status, snapshot status, marker path. List error-report.md paths if any task failed.

### Failure modes

| Condition | Action |
|---|---|
| Feat folder/spec dir missing | Abort, suggest PLAN first |
| No tasks | Abort, suggest re-run PLAN |
| Single task fails 3x | Continue with other tasks, surface in summary |
| All tasks fail | Skip QA + DevOps + Doc-Gen; still run snapshot |
| QA gate fails | Skip DevOps + Doc-Gen; still run snapshot |

## Per-runtime invocation

| Runtime | PLAN invocation | SHIP invocation |
|---|---|---|
| **Claude Code (canonical)** | `/openplanr-pipeline:plan {feature}` | `/openplanr-pipeline:ship {feature}` |
| **Cursor** | User says `plan {feature}` (or "decompose {feature}") — `.cursor/rules/openplanr-pipeline-plan.mdc` activates | User says `ship {feature}` — `openplanr-pipeline-ship.mdc` activates |
| **Codex** | User says `plan {feature}` — AGENTS.md persona triggers | User says `ship {feature}` — same |

In all three runtimes, R1 must be respected: PLAN exits without invoking SHIP, and SHIP requires a separate explicit user invocation.

## See also

- `spec-artifacts.md` — what PLAN writes and SHIP reads
- `agent-roles.md` — the 8 roles PLAN and SHIP orchestrate
- `runtime-adapters.md` — per-runtime command surface details
- `../rules.md` — full rule set including R1

---

*OpenPlanr Protocol v1.0.0 — command contracts.*
