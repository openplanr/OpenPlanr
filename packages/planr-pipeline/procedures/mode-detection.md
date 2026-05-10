# Procedure: Mode detection (shared between /plan and /ship)

> Read by `commands/plan.md` Step 1a and `commands/ship.md` Step 1a. Single source of truth for spec-driven-vs-default mode detection. Both modes are first-class — this procedure does not deprecate or remove either.

## Inputs

- `${SLUG}` — feature slug from `$ARGUMENTS` (without any `feat-` or `spec-` prefix)
- Project root (working directory)

## Algorithm

1. Look for `.planr/config.json` at the project root.
2. If `.planr/config.json` exists AND its `idPrefix.spec` field is set (any string), this is **spec-driven mode**. Scan `.planr/specs/` for a directory matching `^[A-Z]+-\d{3}-${SLUG}$`. The first match resolves to `SPEC_DIR = .planr/specs/<that-dir>` (e.g., `.planr/specs/SPEC-001-auth-flow/` for `${SLUG}=auth-flow`).
3. Otherwise, this is **default mode**. The feature root is `output/feats/feat-${SLUG}/`.

Bind:
- `MODE = "spec-driven" | "default"`
- `SPEC_DIR` (in spec-driven mode only)
- `FEAT_DIR = output/feats/feat-${SLUG}/` (in default mode only)

## Path resolution table

| Concept | Default mode | Spec-driven mode |
|---|---|---|
| Feature root | `output/feats/feat-${SLUG}/` | `<SPEC_DIR>/` |
| Spec source | `input/specs/spec-${SLUG}.md` | `<SPEC_DIR>/SPEC-NNN-${SLUG}.md` |
| US files | `output/feats/feat-${SLUG}/us-*/us-*.md` | `<SPEC_DIR>/stories/US-*.md` |
| Task files | `output/feats/feat-${SLUG}/us-*/tasks/task-*.md` | `<SPEC_DIR>/tasks/T-*.md` |
| Design spec | `output/feats/feat-${SLUG}/design-spec.md` | `<SPEC_DIR>/design/design-spec.md` |
| Error report (`T-<NNN>-error-report.md` after R6 cap) | `output/feats/feat-${SLUG}/us-{N}/tasks/T-<TASK_ID>-error-report.md` | `<SPEC_DIR>/tasks/T-<TASK_ID>-error-report.md` |

`<TASK_ID>` **must mirror** YAML `id` on the artifact being implemented (pattern `^T-\\d{3}$`). **Never write** singleton `tasks/error-report.md`.

Fatal aborts surfaced by callers SHOULD follow **`fatal-error-format.md`** (two-line convention).
| QA report | `output/feats/feat-${SLUG}/qa-report.md` | `<SPEC_DIR>/qa-report.md` |

In spec-driven mode, the spec body has typically already been authored via `planr spec shape`, and decomposition may have already happened via `planr spec decompose` — in which case the specification-agent step becomes a *no-op or refresh* depending on whether US/T files exist. Treat existing US/T files as authoritative (don't overwrite without explicit user intent).

## Self-heal on missing stack.md

When MODE is `spec-driven` AND `input/tech/stack.md` is missing:

1. **Copy the template:** read `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl` and write it verbatim to `input/tech/stack.md`. Create the `input/tech/` directory if absent.
2. **Print:**
   ```
   ✓ Created input/tech/stack.md from template (pipeline self-heal)
     Why: spec-driven mode detected via .planr/config.json, but input/tech/stack.md was missing.
     Critical: BuildCommand and TestCommand drive the 3-iteration correction loop.
               You MUST fill these in before DEV agents will work — empty values mean
               agents cannot validate their generated code.
     Next: edit input/tech/stack.md, then re-run the same command.
   ```
3. **Abort gracefully.** Do NOT invoke any subagent. Do NOT touch the source tree.

When MODE is `default` AND `input/tech/stack.md` is missing, abort with the existing default-mode guidance to copy from `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl`. (No self-heal in default mode — historical behaviour: missing stack typically means missing the entire scaffolding.)

## Required inputs (per command)

Each calling command verifies these exist after detection. If any required input is missing, **abort with a clear error** and do not invoke any subagent.

### /plan

Required (default mode):
- `input/specs/spec-${SLUG}.md` — fail with: "spec-${SLUG}.md not found in input/specs/. Create the file (or use spec-driven mode by initializing with `planr spec init` and re-running)."
- `input/tech/stack.md` — fail with: "input/tech/stack.md not found. Create it from `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl`."

Required (spec-driven mode):
- `<SPEC_DIR>/SPEC-NNN-${SLUG}.md` — if missing, the calling command's auto-scaffold path applies (plan.md only).
- `input/tech/stack.md` — covered by the self-heal pathway above.

### /ship

Required (default mode):
- `output/feats/feat-${SLUG}/` — fail with: "feat-${SLUG}/ not found. Run /planr-pipeline:plan ${SLUG} first."
- At least one `output/feats/feat-${SLUG}/us-*/us-*.md`
- At least one `output/feats/feat-${SLUG}/us-*/tasks/task-*.md`
- `input/tech/stack.md`

Required (spec-driven mode):
- `<SPEC_DIR>/` — fail with: "Spec for slug '${SLUG}' not found under .planr/specs/. Run `planr spec create --slug ${SLUG}` then `planr spec decompose` first."
- At least one `<SPEC_DIR>/stories/US-*.md`
- At least one `<SPEC_DIR>/tasks/T-*.md`
- `input/tech/stack.md` — covered by the self-heal pathway above.

## Conditional / recommended inputs

- `output/db/schema.json` — warn if missing, continue (mode-agnostic).
- Spec-driven mode: `<SPEC_DIR>/design/design-spec.md` — warn if missing.
- Default mode: `output/feats/feat-${SLUG}/design-spec.md` — warn if missing.
- `input/tech/stack.md` has a non-empty `DatabaseType` AND DB env vars are present → calling command may trigger db-agent (mode-agnostic).
- PNG presence (default mode: `input/ui/feat-${SLUG}/*.png` or `UIFiles:` listings; spec-driven: `<SPEC_DIR>/design/*.png`) → calling command may trigger designer-agent.
