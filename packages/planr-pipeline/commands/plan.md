---
description: Run the PO Phase pipeline for a single feature (db-agent → designer-agent → specification-agent)
argument-hint: <feature-name>
---

# /openplanr-pipeline:plan {feature-name}

Orchestrates the PO Phase for `feat-$ARGUMENTS`. Decomposes a functional spec into User Stories + Tasks, optionally with a design spec from PNG mockups and a DB schema snapshot.

**The PO Phase NEVER auto-chains to the DEV Phase.** This command stops after writing US/task files to `output/feats/feat-$ARGUMENTS/`. A human must review (use `/openplanr-pipeline:review $ARGUMENTS`) before invoking `/openplanr-pipeline:ship $ARGUMENTS`. This is enforced by `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1.

---

## Step 1 — Mode detection + input validation

The argument `$ARGUMENTS` is the feature name / slug (without any `feat-` or `spec-` prefix).

### 1a — Detect planr spec mode (NEW in v0.3.0)

**Before any other checks**, look for `.planr/config.json` at the project root:

1. If `.planr/config.json` exists AND its `idPrefix.spec` field is set (any string), assume **planr spec-driven mode**.
2. In spec-driven mode, scan `.planr/specs/` for a directory matching `^[A-Z]+-\d{3}-${ARGUMENTS}$`. The first match resolves to `SPEC_DIR = .planr/specs/<that-dir>` (e.g., `.planr/specs/SPEC-001-auth-flow/` for `$ARGUMENTS=auth-flow`).
3. If `.planr/config.json` is absent OR `idPrefix.spec` is missing, fall through to **default mode** (`output/feats/feat-$ARGUMENTS/`).

For the rest of this command, internally maintain `MODE = "spec-driven"` or `"default"`. Path references below use the right tree based on MODE:

| Concept | Default mode | Spec-driven mode |
|---|---|---|
| Spec source | `input/specs/spec-$ARGUMENTS.md` | `<SPEC_DIR>/SPEC-NNN-${ARGUMENTS}.md` |
| Design spec output | `output/feats/feat-$ARGUMENTS/design-spec.md` | `<SPEC_DIR>/design/design-spec.md` |
| US output | `output/feats/feat-$ARGUMENTS/us-{N}/us-{N}.md` | `<SPEC_DIR>/stories/US-NNN-{slug}.md` |
| Task output | `output/feats/feat-$ARGUMENTS/us-{N}/tasks/task-{M}.md` | `<SPEC_DIR>/tasks/T-NNN-{slug}.md` |

In spec-driven mode, the spec body has typically already been authored via `planr spec shape`, and decomposition may have already happened via `planr spec decompose` — in which case this command's specification-agent step becomes a *no-op or refresh* depending on whether US/T files exist. Treat existing US/T files as authoritative (don't overwrite without explicit user intent — same rule as `planr spec decompose --force` requirement).

### 1b — Validate required inputs

Verify these files/dirs exist. If any required input is missing, **abort with a clear error** and do not invoke any subagent.

Required (default mode):
- `input/specs/spec-$ARGUMENTS.md` — fail with: "spec-$ARGUMENTS.md not found in input/specs/. Run /openplanr-pipeline:spec $ARGUMENTS first."
- `input/tech/stack.md` — fail with: "input/tech/stack.md not found. Run /openplanr-pipeline:init then /openplanr-pipeline:stack to bootstrap."

Required (spec-driven mode):
- `<SPEC_DIR>/SPEC-NNN-${ARGUMENTS}.md` — fail with: "Spec for slug '$ARGUMENTS' not found under .planr/specs/. Run \`planr spec create --slug $ARGUMENTS\` first."
- `input/tech/stack.md` — see **Self-healing in spec mode** below.

### Self-healing in spec mode (NEW in v0.3.1)

In spec-driven mode, users typically arrive here via planr CLI (`planr spec init` + `planr spec create`), which scaffolds `.planr/specs/` but does NOT create `input/tech/stack.md` (that's the pipeline's territory). Failing on a missing stack file would force them to switch tools mid-flow and run `/openplanr-pipeline:init` just to get one file.

Instead, when MODE is `spec-driven` AND `input/tech/stack.md` is missing:

1. **Copy the template:** read `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl` and write it verbatim to `input/tech/stack.md`. Create the `input/tech/` directory if absent.
2. **Print a clear status message:**
   ```
   ✓ Created input/tech/stack.md from template (.claude-plugin pipeline self-heal)
     Why: spec-driven mode detected via .planr/config.json, but input/tech/stack.md was missing.
     Next: edit input/tech/stack.md to declare your real stack:
           - AppName, Language, Framework, ORM (or DatabaseType if no ORM)
           - BuildCommand, TestCommand (used by the 3-iteration correction loop)
     Then re-run: /openplanr-pipeline:plan $ARGUMENTS
   ```
3. **Abort gracefully** — exit Step 1 here. Do NOT invoke any subagent. Do NOT proceed to Step 2.

This self-heal applies only in **spec-driven mode**. In default mode, missing `stack.md` still aborts with the existing "Run `/openplanr-pipeline:init`" guidance — because in default mode, missing stack typically means missing the entire scaffolding, and `/init` is the right answer.

Conditional inputs (presence triggers a subagent; absence skips it silently):
- **Default mode:** `input/ui/feat-$ARGUMENTS/*.png` OR PNGs listed in the spec's `UIFiles:` section → triggers designer-agent
- **Spec mode:** PNGs in `<SPEC_DIR>/design/*.png` → triggers designer-agent
- `input/tech/stack.md` has a non-empty `DatabaseType` AND DB env vars are present → triggers db-agent (mode-agnostic)
- `output/db/schema.json` already up to date → skip db-agent (mode-agnostic)

---

## Step 2 — Invoke subagents in dependency order

Run subagents sequentially. Each subagent's output is consumed by the next.

### 2.1 — Use the **db-agent** subagent (conditional)
- **Skip** if `output/db/schema.json` exists AND was generated within the last 24h AND user did not pass `--rescan`.
- **Skip** if no `DatabaseType` in stack.md.
- Otherwise: delegate to the **db-agent** subagent (Sonnet 4.6, READ-ONLY).
- Output: `output/db/schema.json`.

### 2.2 — Use the **designer-agent** subagent (conditional)
- PNG resolution depends on MODE:
  - **Default mode** — designer-agent resolves PNGs via this priority (see `${CLAUDE_PLUGIN_ROOT}/agents/designer-agent.md`):
    1. PNGs listed in `input/specs/spec-$ARGUMENTS.md` under the `UIFiles:` YAML block
    2. PNGs in `input/ui/feat-$ARGUMENTS/*.png` (feature-namespaced subfolder)
    3. PNGs in `input/ui/*.png` (only if a single feature exists; logs warning)
  - **Spec-driven mode** — PNGs come from `<SPEC_DIR>/design/*.png` (already there because the user attached them via `planr spec attach-design`)
- **Skip silently** if zero PNGs resolve.
- Otherwise: delegate to the **designer-agent** subagent with feature name `$ARGUMENTS` AND the resolved MODE/SPEC_DIR context.
- Output:
  - **Default mode:** `output/feats/feat-$ARGUMENTS/design-spec.md`
  - **Spec-driven mode:** `<SPEC_DIR>/design/design-spec.md`

### 2.3 — Use the **specification-agent** subagent (always)
- **Spec-driven mode optimization:** if `<SPEC_DIR>/stories/` is non-empty (i.e., the user already ran `planr spec decompose`), this step is a NO-OP — the decomposition is already complete. Skip subagent invocation; print "Decomposition already exists (from `planr spec decompose`); skipping specification-agent."
- Otherwise: delegate to the **specification-agent** subagent with feature name `$ARGUMENTS` AND the resolved MODE/SPEC_DIR context.
- Reads (default mode): `input/specs/spec-$ARGUMENTS.md`, `input/tech/stack.md`, optional `output/feats/feat-$ARGUMENTS/design-spec.md`, optional `output/db/schema.json`, plus stack files (plugin defaults at `${CLAUDE_PLUGIN_ROOT}/stacks/...` overlaid by user `.claude/stacks/...`).
- Reads (spec-driven mode): `<SPEC_DIR>/SPEC-NNN-${ARGUMENTS}.md`, `input/tech/stack.md`, optional `<SPEC_DIR>/design/design-spec.md`, optional `output/db/schema.json`, plus stack files (same precedence).
- Output:
  - **Default mode:** `output/feats/feat-$ARGUMENTS/us-{N}/us-{N}.md` and `tasks/task-{M}.md`
  - **Spec-driven mode:** `<SPEC_DIR>/stories/US-NNN-{slug}.md` and `<SPEC_DIR>/tasks/T-NNN-{slug}.md`

---

## Step 3 — Stop

After specification-agent completes, **STOP**. Do NOT invoke any DEV subagent.

Print a summary to the user:
```
✓ PO Phase complete for feat-$ARGUMENTS
  Mode:        <default | spec-driven>     (NEW: shows which path tree was used)
  Output dir:  <output/feats/feat-$ARGUMENTS/ | .planr/specs/SPEC-NNN-$ARGUMENTS/>
  Design spec: <created | skipped (no PNGs) | reused (from planr spec decompose)>
  DB schema:   <created | reused | skipped>
  US created:  N
  Tasks:       M
  Next step:   /openplanr-pipeline:review $ARGUMENTS, then /openplanr-pipeline:ship $ARGUMENTS
```

---

## Failure modes

| Condition | Action |
|-----------|--------|
| Spec missing | Abort, suggest `/openplanr-pipeline:spec $ARGUMENTS` |
| stack.md missing | Abort, suggest `/openplanr-pipeline:init` |
| db-agent fails (connection) | Continue without schema, flag in summary |
| designer-agent fails (corrupt PNG) | Continue without design-spec, flag in summary |
| specification-agent fails | Abort, surface the subagent error |

---

*Reads: spec, stack, ui PNGs, db env vars*
*Writes (default mode): `output/db/schema.json`, `output/feats/feat-{name}/`*
*Writes (spec-driven mode): `output/db/schema.json`, `.planr/specs/SPEC-NNN-{slug}/{design,stories,tasks}/`*
*Does NOT chain to DEV Phase — pipeline stops here for human review (per `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1)*

**Bridge to planr CLI:** when `.planr/config.json` declares spec mode, the pipeline reads from `.planr/specs/` directly with no conversion. See `${CLAUDE_PLUGIN_ROOT}/README.md` for the integration story.
