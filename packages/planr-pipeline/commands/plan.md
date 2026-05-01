---
description: Run the PO Phase pipeline for a single feature (db-agent → designer-agent → specification-agent)
argument-hint: <feature-name>
---

# /planr-pipeline:plan {feature-name}

Orchestrates the PO Phase for `feat-$ARGUMENTS`. Decomposes a functional spec into User Stories + Tasks, optionally with a design spec from PNG mockups and a DB schema snapshot.

**The PO Phase NEVER auto-chains to the DEV Phase.** This command stops after writing US/task files. A human must review the generated stories + tasks before invoking `/planr-pipeline:ship $ARGUMENTS`. This is enforced by `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1.

---

## Step 0 — Pre-flight (greenfield bootstrap, plan mode, brief interpretation)

This step runs **before** mode detection so the pipeline works on greenfield directories and accepts natural-language briefs in `$ARGUMENTS`.

### 0a — Parse `$ARGUMENTS` (slug + optional brief)

`$ARGUMENTS` may take two shapes:

1. **Slug only:** `support-inbox` — feature slug, no extra context.
2. **Slug + brief:** the first whitespace-or-newline-separated token is the slug; everything after is a free-text **BRIEF** (a short natural-language description of the feature, stack, and references).

Internally bind:
- `SLUG = first token of $ARGUMENTS` (kebab-case, no spaces)
- `BRIEF = remainder of $ARGUMENTS` (may be empty)

Use `BRIEF` content during Auto-scaffolding (Step 1b) to populate the spec body's Context, Functional Requirements, Business Rules, and Acceptance Criteria sections — instead of leaving template placeholder text. Use stack hints inside `BRIEF` (mentions of Next.js, Prisma, Postgres, Redis, Anthropic SDK, Vitest, Django, Rails, etc.) to populate `input/tech/stack.md` during Self-healing if missing.

### 0b — Path expansion (universal)

Wherever `BRIEF` or any frontmatter field references a filesystem path, expand:

- `~/foo` → `$HOME/foo` (use the runtime `$HOME` env var)
- `~user/foo` → `/Users/user/foo` (Mac) or `/home/user/foo` (Linux)
- Bare relative paths (e.g. `Designs/file.png`) → resolve against the **project root** (the working directory), NOT against `${CLAUDE_PLUGIN_ROOT}`

If a referenced path doesn't exist after expansion, try the unexpanded form as a fallback (handles cases where users put files in the working dir AND wrote `~/`). If neither resolves, log the expected path and continue — agents that depend on it will skip silently per existing conditional logic (e.g. designer-agent skips if no PNGs).

### 0c — Plan mode awareness

If the user's Claude Code session is in **Plan Mode** (a session-level read-only research mode):

1. **Do NOT bootstrap directories.** Do NOT scaffold the spec. Do NOT dispatch any subagent.
2. Write a markdown plan describing what the pipeline **would** do given the current state:
   - Detected mode (greenfield / spec-driven / default)
   - Files that would be created (`.planr/config.json`, `input/tech/stack.md`, `<SPEC_DIR>/SPEC-NNN-${SLUG}.md`, etc.)
   - Subagents that would fire (db-agent / designer-agent / specification-agent) and the conditions
   - The expected output (`<SPEC_DIR>/stories/`, `<SPEC_DIR>/tasks/`)
3. End the plan with: *"Plan mode is active. Exit Plan Mode and re-run `/planr-pipeline:plan ${SLUG}` to execute."*
4. Stop here. Do not write any files.

### 0d — Greenfield bootstrap

If `.planr/config.json` is missing, write a minimal one. Derive `projectName` from `package.json#name` if present, else from the working directory's basename:

```json
{
  "projectName": "<derived>",
  "outputPaths": { "agile": ".planr" },
  "idPrefix": { "spec": "SPEC" }
}
```

Create these directories if absent:

- `.planr/specs/`
- `input/tech/`

Print:

```
✓ Bootstrapped .planr/ and input/tech/ for greenfield project
```

### 0e — Greenfield Node project ask (CONDITIONAL)

If `package.json` is missing AND `BRIEF` (or `input/tech/stack.md`, if it exists) implies a Node-based stack (mentions Next.js, React, NestJS, Express, etc.):

1. **Ask the user explicitly** — do NOT auto-scaffold without consent:

   ```
   ⚠ Greenfield directory detected (no package.json).

   The pipeline ships FEATURE code on top of an existing project shape.
   To proceed, choose one:

   (a) Reply "scaffold first" — I will run create-next-app (or your stack
       equivalent) + npm install + prisma init, then continue with PO Phase.

   (b) Run the scaffold yourself, then re-run /planr-pipeline:plan ${SLUG}.

   (c) If you only want a plan written and no code generated, exit and
       re-run with Plan Mode active.
   ```

2. Stop here. Wait for the user's reply in the next message.

3. **On user reply `scaffold first`:**
   - Read the brief's stack hints. Default to Next.js 14 (App Router, TypeScript, Tailwind) if not specified, but always prefer what the brief says.
   - Run scaffolding commands sequentially (use Bash):
     - `npx create-next-app@latest . --ts --tailwind --app --src-dir --import-alias "@/*" --no-eslint`
     - `npm i` for declared production deps from BRIEF stack (e.g., `prisma @prisma/client @anthropic-ai/sdk zod ioredis`)
     - `npm i -D` for declared dev deps (e.g., `vitest msw`)
     - `npx prisma init --datasource-provider postgresql` if Prisma is in the stack
   - Print: `✓ Project scaffolded. Continuing to PO Phase.`
   - Then proceed to Step 1.

4. **On user reply other than `scaffold first`:** abort gracefully with a clear message instructing them to scaffold and re-run.

If `package.json` exists already, skip 0e entirely — the project is established.

### 0f — Stack inference from brief (NEW)

After 0d (and 0e if it ran), if `input/tech/stack.md` is missing AND `BRIEF` mentions stack components, author `input/tech/stack.md` from the template at `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl`, populating:

- `AppName` — derive from `projectName` in `.planr/config.json`
- `Language` — from brief (TypeScript, Python, Ruby, etc.)
- `Framework` — from brief (Next.js 14, Django, Rails, NestJS, etc.)
- `DatabaseType` — from brief (PostgreSQL, MongoDB, MySQL, etc.)
- `ORM` — from brief (Prisma, SQLAlchemy, ActiveRecord, etc.)
- `TestFramework` — from brief (Vitest, Jest, pytest, etc.)
- `BuildCommand`, `TestCommand` — sane defaults for the chosen stack

Print:

```
✓ Authored input/tech/stack.md from your brief
```

If `BRIEF` is empty or has no stack hints, fall back to the existing self-heal behavior in Step 1 (copy template verbatim, prompt user to fill it in).

---

## Step 1 — Mode detection + input validation

The argument `$ARGUMENTS` is the feature name / slug (without any `feat-` or `spec-` prefix). At this point Step 0 has already split it into `SLUG` and `BRIEF`. Use `SLUG` for path resolution; use `BRIEF` for content authoring during auto-scaffolding.

### 1a — Detect planr spec mode

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
- `input/specs/spec-$ARGUMENTS.md` — fail with: "spec-$ARGUMENTS.md not found in input/specs/. Create the file (or use spec-driven mode by initializing with `planr spec init` and re-running)."
- `input/tech/stack.md` — fail with: "input/tech/stack.md not found. Create it from `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl`."

Required (spec-driven mode):
- `<SPEC_DIR>/SPEC-NNN-${ARGUMENTS}.md` — if missing, auto-scaffold (see **Auto-scaffolding** below). The pipeline plugin is self-sufficient; no planr CLI required.
- `input/tech/stack.md` — see **Self-healing in spec mode** below.

### Auto-scaffolding the spec shell

When `<SPEC_DIR>/SPEC-NNN-${SLUG}.md` is missing, scaffold it instead of aborting:

1. **Ensure `.planr/config.json` exists.** Step 0d already handled this in greenfield projects. If still absent (rare), write the minimal config from Step 0d.
2. **Ensure `.planr/specs/` exists.** Step 0d already handled this. Create if absent.
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
6. **Copy any referenced PNG mockups** from the brief into `<SPEC_DIR>/design/`. Use the path expansion rules from Step 0b. If a referenced PNG doesn't exist, log it and continue (designer-agent will skip silently).
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

### Self-healing in spec mode

In spec-driven mode, users typically arrive here via planr CLI (`planr spec init` + `planr spec create`), which scaffolds `.planr/specs/` but does NOT create `input/tech/stack.md` (that's the pipeline's territory). Failing on a missing stack file would force them to switch tools mid-flow.

Instead, when MODE is `spec-driven` AND `input/tech/stack.md` is missing:

1. **Copy the template:** read `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl` and write it verbatim to `input/tech/stack.md`. Create the `input/tech/` directory if absent.
2. **Print a clear status message:**
   ```
   ✓ Created input/tech/stack.md from template (.claude-plugin pipeline self-heal)
     Why: spec-driven mode detected via .planr/config.json, but input/tech/stack.md was missing.
     Next: edit input/tech/stack.md to declare your real stack:
           - AppName, Language, Framework, ORM (or DatabaseType if no ORM)
           - BuildCommand, TestCommand (used by the 3-iteration correction loop)
     Then re-run: /planr-pipeline:plan $ARGUMENTS
   ```
3. **Abort gracefully** — exit Step 1 here. Do NOT invoke any subagent. Do NOT proceed to Step 2.

This self-heal applies only in **spec-driven mode**. In default mode, missing `stack.md` still aborts with guidance to copy from `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl` — because in default mode, missing stack typically means missing the entire scaffolding.

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
  Next step:   review the generated US/task files, then /planr-pipeline:ship $ARGUMENTS
```

---

## Failure modes

| Condition | Action |
|-----------|--------|
| Spec missing (default mode) | Abort, suggest creating `input/specs/spec-$ARGUMENTS.md` or switching to spec-driven mode (`planr spec init`) |
| stack.md missing (default mode) | Abort, suggest copying from `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl` |
| db-agent fails (connection) | Continue without schema, flag in summary |
| designer-agent fails (corrupt PNG) | Continue without design-spec, flag in summary |
| specification-agent fails | Abort, surface the subagent error |

---

*Reads: spec, stack, ui PNGs, db env vars*
*Writes (default mode): `output/db/schema.json`, `output/feats/feat-{name}/`*
*Writes (spec-driven mode): `output/db/schema.json`, `.planr/specs/SPEC-NNN-{slug}/{design,stories,tasks}/`*
*Does NOT chain to DEV Phase — pipeline stops here for human review (per `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1)*

**Bridge to planr CLI:** when `.planr/config.json` declares spec mode, the pipeline reads from `.planr/specs/` directly with no conversion. See `${CLAUDE_PLUGIN_ROOT}/README.md` for the integration story.
