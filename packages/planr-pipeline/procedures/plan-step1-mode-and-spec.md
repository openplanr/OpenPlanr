# Procedure: `/planr-pipeline:plan` — Step 1 + Phase B gate

Executed from `commands/plan.md` after Step 0. Uses `SLUG` and `BRIEF` from argument parsing.

---

## Step 1 — Mode detection + input validation

The argument `$ARGUMENTS` was the invocation string; **`SLUG`** is bound from its first token. Use `SLUG` for path resolution; use `BRIEF` for content authoring during auto-scaffolding.

### 1a — Detect planr spec mode

Run procedure: `${CLAUDE_PLUGIN_ROOT}/procedures/mode-detection.md`. After it executes, `MODE` and (for spec-driven mode) `SPEC_DIR` are bound. The procedure also handles the self-heal-on-missing-`stack.md` pathway and the path-resolution table.

### 1b — Validate required inputs

The procedure file at `${CLAUDE_PLUGIN_ROOT}/procedures/mode-detection.md` (section **Required inputs (per command) → /plan**) covers the required-inputs validation for both modes. After it returns:

- If MODE is `spec-driven` AND `<SPEC_DIR>/SPEC-NNN-${SLUG}.md` is missing, do NOT abort — run `${CLAUDE_PLUGIN_ROOT}/procedures/auto-scaffold-spec.md` (the pipeline plugin is self-sufficient and does not require the planr CLI; the procedure decides whether to continue to Step 2 or abort gracefully based on whether `BRIEF` was substantive).
- Otherwise, proceed to Step 2.

---

### Phase B verification gate (mark TodoWrite item 2 complete)

Before continuing to Phase C, verify on disk:

- [ ] `MODE` is determined and bound (`spec-driven` or `default`)
- [ ] In spec mode: `<SPEC_DIR>/SPEC-NNN-${SLUG}.md` exists and contains substantive Context, Functional Requirements, Business Rules, Acceptance Criteria sections (no remaining `_TODO_` placeholders if `BRIEF` was provided)
- [ ] In default mode: `input/specs/spec-${SLUG}.md` exists and is non-empty
- [ ] `input/tech/stack.md` exists OR a clear self-heal abort message has been printed (`mode-detection.md`'s self-healing path)
- [ ] If a stash from `STAGE_DESIGN_ASSETS` was created, `${CLAUDE_PLUGIN_ROOT}/procedures/restore-design-assets.md` has run and the stash dir has been deleted

If any check fails, the spec body has not been authored. Re-execute the missing path before proceeding to subagent dispatch. Do NOT dispatch subagents on a half-built spec.
