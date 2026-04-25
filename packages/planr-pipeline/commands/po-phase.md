---
description: Run the PO Phase pipeline for a single feature (db-agent → designer-agent → specification-agent)
argument-hint: <feature-name>
---

# /openplanr-pipeline:po-phase {feature-name}

Orchestrates the PO Phase for `feat-$ARGUMENTS`. Decomposes a functional spec into User Stories + Tasks, optionally with a design spec from PNG mockups and a DB schema snapshot.

**The PO Phase NEVER auto-chains to the DEV Phase.** This command stops after writing US/task files to `output/feats/feat-$ARGUMENTS/`. A human must review (use `/openplanr-pipeline:review-tasks $ARGUMENTS`) before invoking `/openplanr-pipeline:dev-phase $ARGUMENTS`. This is enforced by `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1.

---

## Step 1 — Validate inputs

The argument `$ARGUMENTS` is the feature name (without the `feat-` prefix or `spec-` prefix).

Verify these files/dirs exist. If any required input is missing, **abort with a clear error** and do not invoke any subagent.

Required:
- `input/specs/spec-$ARGUMENTS.md` — fail with: "spec-$ARGUMENTS.md not found in input/specs/. Run /openplanr-pipeline:shape-spec $ARGUMENTS first."
- `input/tech/stack.md` — fail with: "input/tech/stack.md not found. Run /openplanr-pipeline:init then /openplanr-pipeline:discover-stack to bootstrap."

Conditional inputs (presence triggers a subagent; absence skips it silently):
- `input/ui/feat-$ARGUMENTS/*.png` OR PNGs listed in the spec's `UIFiles:` section → triggers designer-agent
- `input/tech/stack.md` has a non-empty `DatabaseType` AND DB env vars are present → triggers db-agent
- `output/db/schema.json` already up to date → skip db-agent (use existing snapshot)

---

## Step 2 — Invoke subagents in dependency order

Run subagents sequentially. Each subagent's output is consumed by the next.

### 2.1 — Use the **db-agent** subagent (conditional)
- **Skip** if `output/db/schema.json` exists AND was generated within the last 24h AND user did not pass `--rescan`.
- **Skip** if no `DatabaseType` in stack.md.
- Otherwise: delegate to the **db-agent** subagent (Sonnet 4.6, READ-ONLY).
- Output: `output/db/schema.json`.

### 2.2 — Use the **designer-agent** subagent (conditional)
- The designer-agent itself resolves PNGs via this priority order (see `${CLAUDE_PLUGIN_ROOT}/agents/designer-agent.md`):
  1. PNGs listed in `input/specs/spec-$ARGUMENTS.md` under the `UIFiles:` YAML block
  2. PNGs in `input/ui/feat-$ARGUMENTS/*.png` (feature-namespaced subfolder)
  3. PNGs in `input/ui/*.png` (only if a single feature exists; logs warning)
- **Skip silently** if zero PNGs resolve.
- Otherwise: delegate to the **designer-agent** subagent with feature name `$ARGUMENTS`.
- Output: `output/feats/feat-$ARGUMENTS/design-spec.md`.

### 2.3 — Use the **specification-agent** subagent (always)
- Delegate to the **specification-agent** subagent with feature name `$ARGUMENTS`.
- Reads: `input/specs/spec-$ARGUMENTS.md`, `input/tech/stack.md`, optional `output/feats/feat-$ARGUMENTS/design-spec.md`, optional `output/db/schema.json`, plus stack files (plugin defaults at `${CLAUDE_PLUGIN_ROOT}/stacks/...` overlaid by user `.claude/stacks/...`).
- Output: `output/feats/feat-$ARGUMENTS/us-{N}/us-{N}.md` and `tasks/task-{M}.md` files.

---

## Step 3 — Stop

After specification-agent completes, **STOP**. Do NOT invoke any DEV subagent.

Print a summary to the user:
```
✓ PO Phase complete for feat-$ARGUMENTS
  Design spec: <created | skipped (no PNGs)>
  DB schema:   <created | reused | skipped>
  US created:  N
  Tasks:       M
  Next step:   /openplanr-pipeline:review-tasks $ARGUMENTS, then /openplanr-pipeline:dev-phase $ARGUMENTS
```

---

## Failure modes

| Condition | Action |
|-----------|--------|
| Spec missing | Abort, suggest `/openplanr-pipeline:shape-spec $ARGUMENTS` |
| stack.md missing | Abort, suggest `/openplanr-pipeline:init` |
| db-agent fails (connection) | Continue without schema, flag in summary |
| designer-agent fails (corrupt PNG) | Continue without design-spec, flag in summary |
| specification-agent fails | Abort, surface the subagent error |

---

*Reads: spec, stack, ui PNGs, db env vars*
*Writes: output/db/schema.json, output/feats/feat-{name}/*
*Does NOT chain to DEV Phase — pipeline stops here for human review (per `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1)*
