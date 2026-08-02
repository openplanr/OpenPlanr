# Procedure: Auto-scaffold the spec shell (invoked from Step 1)

Executed from `procedures/plan-step1-mode-and-spec.md` when `MODE` is `spec-driven` AND `<SPEC_DIR>/SPEC-NNN-${SLUG}.md` is missing. Scaffolds the spec body instead of aborting; the pipeline plugin is self-sufficient and does not require the planr CLI.

1. **Ensure `.planr/config.json` exists.** Step 0 strategies already handled this in greenfield projects. If still absent (rare), run `${CLAUDE_PLUGIN_ROOT}/procedures/write-planr-dirs.md`.
2. **Ensure `.planr/specs/` exists.** Same as step 1; create if absent.
3. **Determine the next SPEC ID.** Scan `.planr/specs/` for `SPEC-NNN-*/` directories, take the highest NNN, increment. Three-digit format (e.g., `SPEC-001`).
4. **Create the spec directory + subdirs:** `.planr/specs/SPEC-NNN-${SLUG}/{stories,tasks,design}`.
5. **Write the spec body using `BRIEF` if present** (otherwise fall back to the template):
   - **If `BRIEF` is non-empty** (a natural-language description was provided in `$ARGUMENTS`):
     - Use the brief content to populate the spec body sections. The model interprets the brief and writes substantive Context, Functional Requirements, Business Rules, and Acceptance Criteria — NOT placeholder TODOs.
     - Acceptance Criteria must be in Given/When/Then format.
     - Functional Requirements must be specific enough that the specification-agent can decompose into 3-10 tasks.
     - If the brief is short, infer reasonable defaults from the stack and feature name (e.g., a "support inbox" feature implies CRUD + state machine + notifications).
   - **If `BRIEF` is empty:**
     - Read `${CLAUDE_PLUGIN_ROOT}/templates/spec-driven.md.tpl`, substitute `{{SPEC_ID}}`, `{{TITLE}}`, `{{SLUG}}`, `{{DATE}}` (use the slug as fallback title).
     - Write to `<SPEC_DIR>/SPEC-NNN-${SLUG}.md` with placeholder TODOs.
     - Abort with the existing message asking the user to fill it in.
6. **Restore staged assets and copy any other referenced PNG mockups** into `<SPEC_DIR>/design/`:
   - **First**, if a stash exists from `STAGE_DESIGN_ASSETS`, invoke `${CLAUDE_PLUGIN_ROOT}/procedures/restore-design-assets.md` now. This is the moment the spec's `design/` folder exists — the correct restore point.
   - **Then**, for any additional PNGs referenced by `BRIEF` that were NOT in the stash, copy them into `<SPEC_DIR>/design/` using the path expansion rules from `${CLAUDE_PLUGIN_ROOT}/procedures/plan-step0-preflight.md` Step 0.2. If a referenced PNG doesn't exist, log it and continue (designer-agent will skip silently).
7. **Print and abort gracefully (only when `BRIEF` is empty):**

   ```
   ✓ Scaffolded SPEC-NNN-${SLUG} at .planr/specs/SPEC-NNN-${SLUG}/
     Edit the spec body, then re-run: /planr-pipeline:plan ${SLUG}
   ```

8. **Decision: continue or abort:**
   - **If `BRIEF` was provided AND substantively populated the spec sections:** continue to Step 2 (subagent dispatch). The user expressed intent via the brief; don't force them to confirm again.
   - **If `BRIEF` was empty (template placeholder body written):** abort gracefully and wait for the user to fill in the spec body, then re-run.

If the spec body already exists but contains only placeholder text (detect via the literal token `_Describe the problem this feature solves` or any unfilled `_…_` template hint), apply the same abort — the user authored the spec themselves and left it incomplete; respect that.

Schema reference: `OpenPlanr/docs/reference/spec-schema.md` v1.0.0. Specs scaffolded here are interchangeable with `planr spec create` output.
