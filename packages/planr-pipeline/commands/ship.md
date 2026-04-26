---
description: Run the DEV Phase pipeline for a feature (frontend + backend agents per task, then qa, devops, doc-gen, then snapshot)
argument-hint: <feature-name>
---

# /openplanr-pipeline:ship {feature-name}

Orchestrates the DEV Phase for `feat-$ARGUMENTS`. Generates production code from PO-Phase task files, runs the qa-agent gate, optionally generates infra and docs, then refreshes `CLAUDE.md` via the snapshot skill.

**Per `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1, this command MUST NOT be auto-chained from `/openplanr-pipeline:plan`.** A human review step is mandatory between PO Phase and DEV Phase.

---

## Step 0 — Write snapshot sentinel

Touch `.claude/.snapshot-pending` so the Stop hook (in `${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json`) fires a reminder if this command aborts before reaching Step 5.

---

## Step 1 — Mode detection + input validation

### 1a — Detect planr spec mode

**Before any other checks**, look for `.planr/config.json` at the project root:

1. If `.planr/config.json` exists AND its `idPrefix.spec` field is set, assume **planr spec-driven mode**.
2. In spec-driven mode, scan `.planr/specs/` for a directory matching `^[A-Z]+-\d{3}-${ARGUMENTS}$`. The first match resolves to `SPEC_DIR = .planr/specs/<that-dir>`.
3. Otherwise, fall through to **default mode** (`output/feats/feat-$ARGUMENTS/`).

For the rest of this command, internally maintain `MODE = "spec-driven"` or `"default"`. All path references below switch based on MODE:

| Concept | Default mode | Spec-driven mode |
|---|---|---|
| Feature root | `output/feats/feat-$ARGUMENTS/` | `<SPEC_DIR>/` |
| US files | `output/feats/feat-$ARGUMENTS/us-*/us-*.md` | `<SPEC_DIR>/stories/US-*.md` |
| Task files | `output/feats/feat-$ARGUMENTS/us-*/tasks/task-*.md` | `<SPEC_DIR>/tasks/T-*.md` |
| Design spec | `output/feats/feat-$ARGUMENTS/design-spec.md` | `<SPEC_DIR>/design/design-spec.md` |
| Error report | `output/feats/feat-$ARGUMENTS/us-{N}/tasks/error-report.md` | `<SPEC_DIR>/tasks/error-report.md` |
| QA report | `output/feats/feat-$ARGUMENTS/qa-report.md` | `<SPEC_DIR>/qa-report.md` |

### 1b — Validate required inputs

Verify these exist (using mode-appropriate paths). Abort with a clear error if any are missing.

Required (default mode):
- `output/feats/feat-$ARGUMENTS/` — fail with: "feat-$ARGUMENTS/ not found. Run /openplanr-pipeline:plan $ARGUMENTS first."
- At least one `output/feats/feat-$ARGUMENTS/us-*/us-*.md`
- At least one `output/feats/feat-$ARGUMENTS/us-*/tasks/task-*.md`
- `input/tech/stack.md`

Required (spec-driven mode):
- `<SPEC_DIR>/` — fail with: "Spec for slug '$ARGUMENTS' not found under .planr/specs/. Run \`planr spec create --slug $ARGUMENTS\` then \`planr spec decompose\` first."
- At least one `<SPEC_DIR>/stories/US-*.md`
- At least one `<SPEC_DIR>/tasks/T-*.md`
- `input/tech/stack.md` — see **Self-healing in spec mode** below.

### Self-healing in spec mode

Same logic as `/plan`: when MODE is `spec-driven` AND `input/tech/stack.md` is missing, do not abort with a stack-missing error. Instead:

1. **Copy** `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl` to `input/tech/stack.md` (creating `input/tech/` if absent).
2. **Print:**
   ```
   ✓ Created input/tech/stack.md from template (pipeline self-heal)
     Why: spec-driven mode detected, but input/tech/stack.md was missing.
     Critical: BuildCommand and TestCommand drive the 3-iteration correction loop.
               You MUST fill these in before /ship will work — empty values mean DEV
               agents cannot validate their generated code.
     Next: edit input/tech/stack.md, then re-run: /openplanr-pipeline:ship $ARGUMENTS
   ```
3. **Abort gracefully.** Do NOT invoke any subagent. Do NOT touch the source tree.

In default mode, missing `stack.md` continues to abort with "Run `/openplanr-pipeline:init`" guidance — no change.

Recommended (mode-specific):
- `output/db/schema.json` — warn if missing, continue (mode-agnostic).
- Default mode: `output/feats/feat-$ARGUMENTS/design-spec.md` — warn if missing.
- Spec-driven mode: `<SPEC_DIR>/design/design-spec.md` — warn if missing.

---

## Step 2 — Iterate User Stories in topological order

In default mode, iterate each `us-{N}` directory under `output/feats/feat-$ARGUMENTS/` (sorted by US number).
In spec-driven mode, iterate each `<SPEC_DIR>/stories/US-*.md` (sorted by ID); the corresponding tasks live in the *flat* `<SPEC_DIR>/tasks/` directory and reference their parent story via the `storyId` frontmatter field.

For each story, run its tasks:

1. Read the US file to identify which tasks belong to it (via `storyId` frontmatter on each task in spec-driven mode; via directory containment in default mode).
2. For each task:
   - Read the task's frontmatter `Type` field (always present in spec-driven mode; present as `Type: UI|Tech` in default mode).
   - If `Type: UI` → delegate to the **frontend-agent** subagent (Opus 4.7).
   - If `Type: Tech` → delegate to the **backend-agent** subagent (Opus 4.7).
   - The subagent receives MODE/SPEC_DIR context so it knows where to write the error-report on failure.
   - frontend-agent and backend-agent tasks within the SAME US may run in parallel (per `${CLAUDE_PLUGIN_ROOT}/docs/pipeline-overview.md`).
3. Each subagent applies the **3-iteration correction loop** (see `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R6):
   - Iteration 1: direct fix on build/test failure.
   - Iteration 2: re-read task spec + design-spec/schema, fix holistically.
   - Iteration 3: minimal safe fix, flag remaining issues.
   - On 3rd failure: write `${CLAUDE_PLUGIN_ROOT}/templates/error-report.md`-shaped report:
     - **Default mode:** `output/feats/feat-$ARGUMENTS/us-{N}/tasks/error-report.md`
     - **Spec-driven mode:** `<SPEC_DIR>/tasks/error-report.md` (flat, since spec-driven tasks live in a single flat tasks/ dir)
     - Then STOP that task.
4. If a task fails after 3 iterations, ship continues with other independent tasks but flags the failed task in the final summary.

---

## Step 3 — QA Gate (Step 3.5)

After all US tasks complete (or fail with error-reports), delegate to the **qa-agent** subagent.

The qa-agent verifies, for each task:
- All "Create" files exist
- All "Modify" files were updated (and only as described)
- All "Preserve" files are unchanged (git diff vs base)
- Tests exist and pass (`BuildCommand` + `TestCommand` from stack.md)
- DoD checklist items are satisfied

If QA fails: flag the failure in summary; **still proceed to Step 5 snapshot** so state is recorded, but skip DevOps and Doc-Gen agents until the underlying task is fixed.

---

## Step 4 — DevOps + Doc-Gen Agents (Step 3.5, parallel, optional)

These run only if QA passes. Skipped via `--no-devops` / `--no-docs` flags in $ARGUMENTS.

- Delegate to the **devops-agent** subagent — generates `docker-compose.yml`, `.env.example`, Dockerfiles, and CI config matching the stack. Per non-goals: this subagent **does NOT deploy** (enforced at the tool layer — the agent has no Bash access).
- Delegate to the **doc-gen-agent** subagent — writes `Docs/feat-$ARGUMENTS/` from the US, tasks, and generated source code.

---

## Step 5 — Snapshot

Invoke the `/openplanr-pipeline:snapshot` skill to refresh `CLAUDE.md` with the latest project state. On success, remove the `.claude/.snapshot-pending` sentinel.

The Stop hook in `${CLAUDE_PLUGIN_ROOT}/hooks/hooks.json` is a backup: if this command aborts before this step, the hook prints a reminder to manually run `/openplanr-pipeline:snapshot`.

---

## Step 5.5 — Write the `.pipeline-shipped` marker

After Step 5 succeeds, write a marker file recording the pipeline run.

**Default mode:** `output/feats/feat-$ARGUMENTS/.pipeline-shipped`
**Spec-driven mode:** `<SPEC_DIR>/.pipeline-shipped`

Contents (YAML):

```yaml
shipped_at: "<ISO 8601 UTC timestamp>"
pipeline_version: "<from ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json>"
mode: "<default | spec-driven>"
feature: "$ARGUMENTS"
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
error_reports:               # paths to any error-report.md files; empty list if none
  - <path>
```

If Step 5 (snapshot) failed but tasks shipped, still write the marker with
`snapshot_status: skipped` so the partial-success state is recorded.

---

## Step 6 — Print summary

```
✓ DEV Phase complete for feat-$ARGUMENTS
  Mode:            <default | spec-driven>
  Output dir:      <output/feats/feat-$ARGUMENTS/ | .planr/specs/SPEC-NNN-$ARGUMENTS/>
  Tasks succeeded: X / Y
  Tasks failed:    Z (see error-report.md files)
  QA gate:         <passed | failed>
  DevOps config:   <generated | skipped>
  Docs:            <generated | skipped>
  CLAUDE.md:       refreshed
  Marker:          <output dir>/.pipeline-shipped     ← proof of pipeline execution
```

If spec-driven mode was active, the spec's frontmatter `status` is updated to `in-pipeline` while ship runs and to `done` on full success.

If any task failed, list paths to the error-report.md files.

---

## Failure modes

| Condition | Action |
|-----------|--------|
| feat folder missing | Abort, suggest `/openplanr-pipeline:plan $ARGUMENTS` |
| No tasks | Abort, suggest re-run of PO Phase |
| Single task fails 3x | Continue with other tasks, surface in summary |
| All tasks fail | Skip QA + DevOps + Doc-Gen; still run snapshot to record state |
| QA gate fails | Skip DevOps + Doc-Gen; still run snapshot |

---

*Reads (default mode): `output/feats/feat-{name}/`, `stack.md`, `schema.json`, `design-spec.md`*
*Reads (spec-driven mode): `.planr/specs/SPEC-NNN-{slug}/`, `stack.md`, `schema.json`, `design-spec.md`*
*Writes: `src/features/{name}/`, tests, `docker-compose.yml` (optional), `Docs/` (optional), `CLAUDE.md` (via snapshot)*
*Per `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1: must be invoked manually after human review of PO Phase output.*

**Bridge to planr CLI:** in spec-driven mode, this command reads/writes `.planr/specs/` directly — no conversion. The planr CLI is the *authoring* surface; openplanr-pipeline is the *executor*.
