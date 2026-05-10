# Procedure: `/planr-pipeline:plan` — Step 2 → Step 3 + failure modes

Executed from `commands/plan.md` after Step 1.

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

### Phase C verification gate (mark TodoWrite item 3 complete)

Before continuing to Phase D, verify on disk:

- [ ] db-agent has either run (output exists) OR was explicitly skipped per its conditional logic — log says which
- [ ] designer-agent has either run (`design-spec.md` exists) OR was explicitly skipped (no PNGs) — log says which
- [ ] specification-agent has either run (US + Task files exist) OR a pre-existing `<SPEC_DIR>/stories/` directory was reused
- [ ] Output dir contains ≥1 US-*.md file
- [ ] Output dir contains ≥1 Task file
- [ ] No subagent abort message is unresolved

If any check fails, surface the error to the user and abort. Do NOT print a success summary on a failed Phase C.

---

## Step 3 — Verify completion + summary + stop

### 3.1 — Run the Completion Contract (mandatory)

Before printing any summary, verify ALL of the following on disk. **The PO Phase is not complete until every checkbox passes.**

#### Bootstrap layer

- [ ] `.planr/config.json` exists and is valid JSON (or strategy was `ASK_MANUAL`/`ASK_STACK` — in which case the command should already have stopped before reaching here)
- [ ] `input/tech/stack.md` exists OR a self-heal abort already printed (in default mode `stack.md` is hard-required; in spec mode it self-heals)

#### Spec layer

- [ ] Spec body file exists at the mode-appropriate path (`<SPEC_DIR>/SPEC-NNN-${SLUG}.md` or `input/specs/spec-${SLUG}.md`)
- [ ] Spec body has **substantive** Context, Functional Requirements, Business Rules, Acceptance Criteria sections — verify by reading the file and confirming none of the strings `_TODO_`, `_Describe the problem`, `<feature description>` remain (if `BRIEF` was provided; if `BRIEF` was empty, the command should already have aborted gracefully at Step 1's auto-scaffold step 7)
- [ ] `<SPEC_DIR>/design/` exists (may be empty, that's fine)

#### Decomposition layer

- [ ] Stories directory contains ≥1 file: `<SPEC_DIR>/stories/US-*.md` or `output/feats/feat-${SLUG}/us-*/`
- [ ] Tasks directory contains ≥1 file: `<SPEC_DIR>/tasks/T-*.md` or `output/feats/feat-${SLUG}/us-*/tasks/`

#### Subagent dispatch evidence

- [ ] Phase C verification gate above has been satisfied (db-agent + designer-agent + specification-agent each ran or explicitly logged a skip)

#### Stash cleanup

- [ ] If `STAGE_DESIGN_ASSETS` ran, **`restore-design-assets`** also ran AND the stash dir has been deleted (verify `/tmp/planr-pipeline-stash/<SLUG>-*` no longer exists)

### 3.2 — Termination policy

- If ANY contract checkbox fails, you have NOT completed the PO Phase. Continue executing the missing steps. **Do NOT print success.**
- If a check is genuinely unresolvable (e.g., specification-agent crashed), abort with a clear error message identifying which check failed and what state was reached. **Do NOT print the success summary.**
- Only after all checks pass: mark the final TodoWrite item complete and continue to 3.3.

### 3.3 — Print success summary + stop

After the contract passes, print:

```
✓ PO Phase complete for ${SLUG}
  Mode:        <default | spec-driven>
  Strategy:    <CONTINUE | BOOTSTRAP_ONLY | SCAFFOLD_NODE>
  Output dir:  <output/feats/feat-${SLUG}/ | .planr/specs/SPEC-NNN-${SLUG}/>
  Design spec: <created | skipped (no PNGs) | reused (from planr spec decompose)>
  DB schema:   <created | reused | skipped>
  US created:  N
  Tasks:       M
  Next step:   review the generated US/task files, then /planr-pipeline:ship ${SLUG}
```

**STOP.** Do NOT invoke any DEV subagent. Do NOT auto-chain to `/ship`. Per R1 (`${CLAUDE_PLUGIN_ROOT}/docs/rules.md`), a human review step is mandatory.

---

## Failure modes

| Condition | Action |
|---|---|
| `$ARGUMENTS` malformed (>5000 chars or contains nested invocation) | Abort at Step 0.0 with sanitization message |
| Project root contains unrecognized non-asset files (SCAFFOLD_NODE) | Abort at SCAFFOLD_NODE checklist step 3, suggest cleanup |
| Spec missing (default mode, no BRIEF) | Abort at Step 1, suggest creating `input/specs/spec-${SLUG}.md` or `planr spec init` |
| `stack.md` missing (default mode) | Abort at Step 1, suggest copying from `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl` |
| Scaffolder fails (SCAFFOLD_NODE) | Run failure path from `restore-design-assets.md`; abort with underlying error |
| db-agent fails (connection) | Continue without schema, flag in summary |
| designer-agent fails (corrupt PNG) | Continue without design-spec, flag in summary |
| specification-agent fails | Abort, surface the subagent error; Phase C gate fails |
| Completion Contract checkbox fails | Continue executing missing steps; do not print success |

---

*Reads (this procedure): stack, PNGs under mode rules, DB env vars*

*Writes (default mode): `output/db/schema.json`, `output/feats/feat-{name}/`*

*Writes (spec-driven mode): `output/db/schema.json`, `.planr/specs/SPEC-NNN-{slug}/{design,stories,tasks}/`*

*Does NOT chain to DEV Phase — pipeline stops here for human review (`${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1).*
