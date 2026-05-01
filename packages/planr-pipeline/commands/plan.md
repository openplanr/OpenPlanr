---
description: Run the PO Phase pipeline for a single feature (db-agent → designer-agent → specification-agent)
argument-hint: <feature-name>
---

# /planr-pipeline:plan {feature-name}

Orchestrates the PO Phase for `feat-$ARGUMENTS`. Decomposes a functional spec into User Stories + Tasks, optionally with a design spec from PNG mockups and a DB schema snapshot.

**The PO Phase NEVER auto-chains to the DEV Phase.** This command stops after writing US/task files. A human must review the generated stories + tasks before invoking `/planr-pipeline:ship $ARGUMENTS`. This is enforced by `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1.

---

## ORCHESTRATION CONTRACT (read this first, mandatory)

This command has **EXACTLY** these phases, in order:

| Phase | Purpose | Outputs |
|---|---|---|
| **A — Pre-flight** | Parse args, set up project state | `.planr/config.json`, `input/tech/stack.md` (when applicable) |
| **B — Mode + spec body** | Detect mode, author spec body from BRIEF | `<SPEC_DIR>/SPEC-NNN-${SLUG}.md` with substantive content |
| **C — Subagent dispatch** | Run db-agent → designer-agent → specification-agent | DB snapshot, design-spec.md, US/Task files |
| **D — R1 gate (stop)** | Verify completion + print summary + stop | Console summary, NO `/ship` chain |

### Termination rule

**You are NOT done when a Bash command succeeds. You are NOT done when scaffolding completes. You are NOT done when bootstrap files are written.**

You are done ONLY when the **Completion Contract** at the bottom of this document is satisfied — every checkbox verified on disk.

If you cannot complete a phase (subagent fails, scaffolder fails, missing dep), abort with a clear error identifying which phase failed and what state was reached. **Do not print success.** Do not silently exit.

### TodoWrite is mandatory

At the **start** of execution, immediately create a TodoWrite list with these 4 items:

1. `Phase A — Pre-flight (state strategy + bootstrap)`
2. `Phase B — Mode detection + spec body authored`
3. `Phase C — Subagent dispatch (db, designer, specification)`
4. `Phase D — Verify completion contract + print summary`

Mark each item `in_progress` before starting it, `completed` only after on-disk verification of its outputs (per the per-phase verification gates inline below). This is non-negotiable — without it, the model loses track on long executions and silently abandons mid-task.

### After every Bash tool call, ask: "did this complete the phase, or just one step?"

Bash success is a step result, not a phase result. After every successful Bash command, return to the strategy you're executing and continue with the next sub-step. Only the Completion Contract can mark the command done.

---

## Step 0 — Pre-flight (state machine)

Step 0 runs **before** mode detection. Its job is to bring the project to a state where Step 1 can run unconditionally.

It is structured as a state machine, not an imperative sequence. The model:

1. **Parses** `$ARGUMENTS` into `SLUG` + optional `BRIEF`
2. **Resolves paths** universally (`~/foo` → `$HOME/foo`)
3. **Short-circuits** if the session is in Plan Mode
4. **Detects** project state via read-only signals (no writes during detection)
5. **Picks** exactly one strategy from the decision matrix
6. **Executes** the chosen strategy as a clean linear sequence

Each strategy is internally consistent — there is no ordering ambiguity, and the model never has to improvise around contradictions between substeps.

### 0.0 — Sanitize `$ARGUMENTS` (defensive)

Before any other processing, validate that `$ARGUMENTS` is a sane invocation:

- If `$ARGUMENTS` exceeds **5,000 characters**, abort with: `⚠ $ARGUMENTS is unexpectedly long (>5000 chars). This usually means a previous conversation was accidentally pasted in. Re-invoke with: /planr-pipeline:plan {slug} {short brief}`
- If `$ARGUMENTS` contains the literal substring `/planr-pipeline:` (suggesting a nested invocation got pasted), abort with the same message.
- If `$ARGUMENTS` is empty, abort with: `⚠ Missing slug. Usage: /planr-pipeline:plan {slug} [brief]`

These are pure defensive checks against the rare case where a user pastes prior conversation content into the command. They cost nothing on normal invocations and prevent the model from operating on garbage input.

### 0.1 — Parse `$ARGUMENTS`

`$ARGUMENTS` may take two shapes:

1. **Slug only:** `support-inbox`
2. **Slug + BRIEF:** first whitespace-or-newline-separated token is the slug; everything after is a free-text natural-language description (feature, stack, file references)

Bind:

- `SLUG` = first token of `$ARGUMENTS` (kebab-case; reject if it contains spaces or special characters other than `-` and digits)
- `BRIEF` = remainder of `$ARGUMENTS` (may be empty)

`BRIEF` is used downstream for: spec body authoring, stack inference, and PNG path resolution. `SLUG` is used for path resolution and ID derivation.

### 0.2 — Path expansion (applies throughout this command)

Wherever a filesystem path is read from `BRIEF`, frontmatter, or any other source, apply this expansion in order:

1. **Tilde expansion:** `~/foo` → `$HOME/foo`. `~user/foo` → user's home + `/foo` (`/Users/user/foo` on Mac, `/home/user/foo` on Linux).
2. **Bare relative paths:** resolve against the **project root** (working directory), NOT `${CLAUDE_PLUGIN_ROOT}`.

**Resolution rule (no silent dangerous fallback):**

- If the **expanded path** resolves to an existing file → use it.
- If the expanded path doesn't exist, **do NOT silently fall back** to a different location. Log a warning of the form:

  ```
  ⚠ Path not found: <as-written-in-brief> (expanded: <expanded-path>).
    The reference will be skipped; downstream agents that depend on it
    will skip silently.
  ```

  Then continue. Downstream conditional logic (e.g., designer-agent) skips cleanly when its inputs aren't found.

**Why no fallback:** silent fallback to project-local paths can pull in files that conflict with the scaffolder (e.g., a `Designs/` folder in the project root makes `create-next-app .` refuse to run). A loud warning is safer than a clever guess.

### 0.3 — Plan Mode short-circuit

If the user's Claude Code session is in **Plan Mode** (the read-only session mode):

1. Run state detection (Step 0.4) to determine what the pipeline **would** do
2. Write a markdown plan describing the chosen strategy + each of its steps
3. End with: *"Plan Mode is active. Exit Plan Mode and re-run `/planr-pipeline:plan ${SLUG}` to execute."*
4. Stop. Do not write any other files. Do not dispatch any subagent. Do not run any Bash command.

### 0.4 — Detect project state (read-only)

Read these signals **without writing anything**:

| Signal | Check |
|---|---|
| `HAS_PLANR` | `.planr/config.json` exists at the project root |
| `HAS_PACKAGE_JSON` | `./package.json` exists at the project root |
| `HAS_SPEC` | A directory matching `.planr/specs/SPEC-\d{3}-${SLUG}/` exists |
| `HAS_STACK` | `input/tech/stack.md` exists |
| `BRIEF_STACK` | Inspect `BRIEF` for stack keywords. Classify as `node` / `non-node` / `none` |

**`BRIEF_STACK` keyword classification (case-insensitive substring match):**

- `node` keywords:
  - **Frameworks with canonical scaffolders:** `Next.js`, `NestJS`, `Vite`, `Nuxt`, `Astro`, `Remix`, `SvelteKit`, `Svelte`, `SolidStart`, `Solid`, `Hono`, `Fastify`, `Express`
  - **Libraries / runtimes:** `React`, `Vue`, `Lit`, `tRPC`, `Node`, `Bun`, `Deno`
  - **Tooling:** `npm`, `pnpm`, `yarn`, `Vitest`, `Jest`, `Playwright`, `Drizzle`
- `non-node` keywords:
  - `Django`, `FastAPI`, `Flask`, `Rails`, `Laravel`, `Spring`, `Phoenix`, `Gin`, `Echo`, `ASP.NET`, `.NET`, `Symfony`, `Sinatra`
- `none`: BRIEF is empty OR contains neither set

When BRIEF mentions a Node framework not in this list (e.g., a framework released after this list was authored), the model should still classify as `node` if the framework is clearly Node-ecosystem (built on Node runtime, distributed via npm). Reserve `non-node` for clearly non-JS-runtime stacks. The list is illustrative, not exhaustive.

If `BRIEF` mentions both (rare hybrid stack), prefer `node` for the auto-scaffold path. Users on hybrid stacks can override by hand-authoring `stack.md` first.

### 0.5 — Pick exactly one strategy

| `HAS_PLANR` | `HAS_PACKAGE_JSON` | `BRIEF_STACK` | Strategy |
|---|---|---|---|
| ✅ | any | any | `CONTINUE` |
| ❌ | ✅ | any | `BOOTSTRAP_ONLY` |
| ❌ | ❌ | `node` | `SCAFFOLD_NODE` |
| ❌ | ❌ | `non-node` | `ASK_MANUAL` |
| ❌ | ❌ | `none` | `ASK_STACK` |

Five rows. Five states. Mutually exclusive. Total coverage. No undefined behavior.

### 0.6 — Execute the chosen strategy

#### Strategy: `CONTINUE`

Project is fully initialized. Step 0 has nothing to do.

1. Print: `✓ State: continue (existing planr project)`
2. Proceed to Step 1.

If `HAS_SPEC` is true, Step 1 sees the existing spec and dispatches the agents. If `HAS_SPEC` is false, Step 1's auto-scaffolding (Step 1b below) handles spec body authoring — it uses `BRIEF` if present, falls back to the template otherwise.

#### Strategy: `BOOTSTRAP_ONLY`

Existing Node project, first-time planr install. **No scaffolding.**

1. Print: `✓ State: bootstrap-only (existing project, first planr install)`
2. Apply common procedure `WRITE_PLANR_DIRS` (Step 0.7 below)
3. Apply common procedure `AUTHOR_STACK_FROM_BRIEF` if `BRIEF` mentions stack components (Step 0.8 below)
4. Proceed to Step 1.

#### Strategy: `SCAFFOLD_NODE`

Greenfield directory + Node-stack brief. Intent is unambiguous. **Auto-scaffold without a consent prompt** — premium UX dictates the system act on clear intent.

**Execute as an explicit checklist.** Add these items to the TodoWrite list (under Phase A) and check them off as you complete each:

```
SCAFFOLD_NODE checklist (each must complete before continuing):
  1. Identify primary framework from BRIEF
  2. Stage pre-existing assets via STAGE_DESIGN_ASSETS (Step 0.9)
  3. Verify project root is now empty (or contains only hidden files)
  4. Announce scaffolding
  5. Run framework scaffolder
  6. Install additional deps from BRIEF
  7. Run post-scaffold init commands
  8. Apply WRITE_PLANR_DIRS (Step 0.7)
  9. Apply AUTHOR_STACK_FROM_BRIEF (Step 0.8)
  10. Apply RESTORE_DESIGN_ASSETS (Step 0.10) — copy stash into the spec design folder later (after Step 1 spec scaffold)
  11. Mark Phase A complete; continue to Phase B (Step 1)
```

Do not skip ahead. Do not return until item 11 is done.

**1. Identify primary framework from `BRIEF`.**

The "primary" framework is the one that defines the project shape — typically the first one mentioned, or the one most prominently described:

- "Next.js + Prisma + Postgres" → primary is **Next.js**
- "NestJS + TypeORM + Postgres + Redis" → primary is **NestJS**
- "Vite + React + Tailwind" → primary is **Vite (React)**
- "Astro + Solid" → primary is **Astro**

If `BRIEF` mentions multiple top-level frameworks at the same level (rare hybrid), pick the one with a canonical CLI scaffolder. If still ambiguous, default to **Next.js**.

**2. Stage pre-existing assets via `STAGE_DESIGN_ASSETS`.**

Before running any scaffolder, invoke common procedure `STAGE_DESIGN_ASSETS` (Step 0.9 below). This moves any pre-existing design asset folders/files (e.g., a project-local `Designs/`) to a `/tmp` stash so the scaffolder sees an empty directory. The stash location is recorded in a session variable `STASH_DIR` for `RESTORE_DESIGN_ASSETS` later.

**3. Verify project root is empty.**

After `STAGE_DESIGN_ASSETS`, run `ls -A` on the project root. Acceptable contents:

- Empty directory
- Only hidden entries (`.git/`, `.gitignore`)

If anything else remains (files we don't recognize), abort with:

```
⚠ Project root contains files we don't auto-stage: <list>
  STAGE_DESIGN_ASSETS only handles known design asset patterns
  (Designs/, design/, mockups/, *.png, *.jpg, *.svg, etc.).

  Please move these aside or delete them, then re-run.
```

This is the **only** scaffolder-blocker recovery the pipeline owns. We do NOT improvise around unknown files.

**4. Announce.**

```
→ State: scaffold-node
  Scaffolding <framework> from your brief. ~2 min.
  Press Esc to abort.
```

**5. Run the framework's canonical scaffolder in the (now empty) project root.**

Apply these defaults (override only when `BRIEF` explicitly says otherwise):

- TypeScript by default (`--ts`, `--typescript`, `--template <name>-ts`, etc.) — every modern Node project
- Skip git init (`--no-git`, `--skip-git`) — git is already initialized at the project root
- Pin npm (`--use-npm`, `--package-manager npm`) for consistency with the rest of the strategy
- Skip auto-install (`--skip-install`) when the scaffolder offers it — we run `npm i` ourselves to be explicit about deps

**Supported Node-ecosystem scaffolders** (the model is expected to know these from training, but they're documented here as the supported universe):

| Framework | Canonical scaffold command |
|---|---|
| Next.js | `npx create-next-app@latest .` |
| NestJS | `npx @nestjs/cli@latest new .` |
| Vite (React / Vue / Svelte / Solid / Lit) | `npm create vite@latest .` |
| Nuxt | `npx nuxi@latest init .` |
| Astro | `npm create astro@latest .` |
| Remix | `npx create-remix@latest .` |
| SvelteKit | `npm create svelte@latest .` |
| Hono | `npm create hono@latest .` |
| SolidStart | `npm create solid@latest .` |
| Fastify | (no canonical CLI — `npm init -y` + `npm i fastify` + minimal `src/server.ts`) |
| Express (custom) | (no canonical CLI — `npm init -y` + `npm i express` + minimal `src/server.ts`) |

For each scaffolder, apply the appropriate flag for each default above. If the brief mentions feature flags (e.g., "Tailwind", "App Router", "src dir"), include the corresponding scaffolder flag (`--tailwind`, `--app`, `--src-dir`). If the framework has no canonical CLI, fall back to the manual init pattern (npm init + install + minimal entry file).

If the brief names a Node framework not on this list, the model should still attempt a sensible scaffold using the framework's documented quickstart commands — falling back to manual `npm init` if no clear pattern exists.

**6. Install additional dependencies declared in `BRIEF`.**

- Production: `npm i <deps>` for packages beyond what the scaffolder installed (e.g., `prisma @prisma/client`, `@anthropic-ai/sdk`, `ioredis`, `zod`, `stripe`)
- Dev: `npm i -D <deps>` for testing + tooling (e.g., `vitest @vitest/ui msw @testing-library/react`)

Group dependencies into a single `npm i` call where possible to avoid redundant resolver runs.

**7. Run post-scaffold init commands implied by `BRIEF`.**

- Prisma in BRIEF → `npx prisma init --datasource-provider <postgresql|mysql|sqlite|mongodb>`
- Drizzle in BRIEF → no init needed; the schema file is hand-authored later by the backend-agent
- Other tooling that requires explicit init → run accordingly

**8. Print:** `✓ Project scaffolded.`

**9. Apply common procedures** (in order):

- `WRITE_PLANR_DIRS` (Step 0.7)
- `AUTHOR_STACK_FROM_BRIEF` (Step 0.8)

**10. Print:** `✓ Bootstrapped .planr/. Continuing to PO Phase.`

**11. Continue to Phase B (Step 1).** **You are not done. Mark this checklist complete only after Step 1 + Step 2 + Completion Contract all pass.** `RESTORE_DESIGN_ASSETS` runs inside Step 1 (auto-scaffolding the spec) once the spec's `design/` folder exists.

**Error handling.** If any scaffolder command fails (network error, flag deprecation, package not found, unsupported Node version):

1. Run `RESTORE_DESIGN_ASSETS` to move the stash back to the project root (cleanup, no half-state)
2. Abort with a clear error identifying the failed step + the underlying error message

**Do NOT improvise recovery** — no force flags, no second creative `mv` stash beyond the designed `STAGE_DESIGN_ASSETS` / `RESTORE_DESIGN_ASSETS` pair. The user fixes the underlying issue (network, Node version, etc.) and re-runs.

#### Strategy: `ASK_MANUAL`

Greenfield + non-Node brief. The pipeline does not ship scaffolders for non-Node stacks.

Print and stop. Write nothing.

```
⚠ State: ask-manual

Greenfield directory + non-Node stack detected (<inferred-stack>).
The pipeline doesn't ship scaffolders for non-Node stacks.

Please:
  1. Scaffold your project (django-admin startproject, rails new, etc.)
  2. cd into the scaffolded directory
  3. Re-run /planr-pipeline:plan ${SLUG} with your brief
```

#### Strategy: `ASK_STACK`

Greenfield + no stack hint in `BRIEF`. Pipeline cannot infer intent.

Print and stop. Write nothing.

```
⚠ State: ask-stack

Greenfield directory detected, but no stack mentioned in your brief.

Please re-run with one of:
  (a) A brief that declares the stack:
      /planr-pipeline:plan ${SLUG}
      <feature description>
      Stack: Next.js + Prisma + Postgres + Anthropic SDK + Vitest

  (b) An existing input/tech/stack.md authored by hand from
      ${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl
```

### 0.7 — Common procedure: `WRITE_PLANR_DIRS`

Referenced by `BOOTSTRAP_ONLY` and `SCAFFOLD_NODE`.

1. Write `.planr/config.json` with derived values:

   ```json
   {
     "projectName": "<package.json#name OR working dir basename>",
     "outputPaths": { "agile": ".planr" },
     "idPrefix": { "spec": "SPEC" }
   }
   ```

2. Create `.planr/specs/` if absent
3. Create `input/tech/` if absent

### 0.8 — Common procedure: `AUTHOR_STACK_FROM_BRIEF`

Referenced by `BOOTSTRAP_ONLY` and `SCAFFOLD_NODE`. Only runs if `BRIEF` is non-empty AND mentions stack components.

1. Read template: `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl`
2. Populate fields from `BRIEF`:
   - `AppName` from `.planr/config.json#projectName`
   - `Language` (TypeScript / Python / Ruby / Go / etc.)
   - `Framework` (Next.js / Django / Rails / NestJS / etc.)
   - `DatabaseType` (PostgreSQL / MongoDB / MySQL / etc.)
   - `ORM` (Prisma / SQLAlchemy / ActiveRecord / etc.)
   - `TestFramework` (Vitest / Jest / pytest / etc.)
   - `BuildCommand`, `TestCommand` — sane defaults for the chosen stack
3. Write to `input/tech/stack.md`
4. Print: `✓ Authored input/tech/stack.md from your brief`

If `BRIEF` is empty or has no stack hints, leave `input/tech/stack.md` absent. The existing self-heal in Step 1 handles it (writes template verbatim, prompts user to fill in).

### 0.9 — Common procedure: `STAGE_DESIGN_ASSETS`

Referenced by `SCAFFOLD_NODE` (only). Used to safely move pre-existing design assets out of the project root before running a scaffolder that requires an empty directory.

**Recognized patterns** (only these are touched — anything else aborts):

- Folders: `Designs/`, `design/`, `designs/`, `mockups/`, `mocks/`, `assets/`, `wireframes/`
- Top-level files: `*.png`, `*.jpg`, `*.jpeg`, `*.svg`, `*.gif`, `*.webp`

**Steps:**

1. Compute `STASH_DIR = /tmp/planr-pipeline-stash/<SLUG>-<unix-timestamp>/`. Bind it to a session variable so `RESTORE_DESIGN_ASSETS` can find it later.
2. Scan the project root (top level only — do NOT recurse). Build two lists:
   - `KNOWN_ASSETS` — paths matching the recognized patterns
   - `UNKNOWN_FILES` — anything else that is not a hidden entry (`.git`, `.gitignore` are always allowed)
3. If `UNKNOWN_FILES` is non-empty, **abort** with the message defined in `SCAFFOLD_NODE` step 3. Do NOT proceed with the scaffold.
4. If `KNOWN_ASSETS` is empty, log `→ No pre-existing assets to stage.` and return.
5. Otherwise, print exactly what will be moved:

   ```
   ⚠ Pre-existing design assets detected. Staging before scaffold:
       Designs/ → /tmp/planr-pipeline-stash/<SLUG>-<ts>/Designs/
       inbox.png → /tmp/planr-pipeline-stash/<SLUG>-<ts>/inbox.png
     They will be restored to .planr/specs/SPEC-NNN-${SLUG}/design/
     after scaffolding completes.
   ```

6. Create `STASH_DIR` (via `mkdir -p`) and `mv` each `KNOWN_ASSETS` entry into it, preserving names.
7. Verify the project root is empty (or only hidden entries remain). If anything is still there, abort with: `⚠ STAGE_DESIGN_ASSETS could not clear the project root. Files still present: <list>`.

**Failure mode:** if `mv` fails for any reason (permissions, disk full), abort and tell the user. Do NOT continue to scaffold a partially-empty directory.

### 0.10 — Common procedure: `RESTORE_DESIGN_ASSETS`

Referenced by `SCAFFOLD_NODE` (only). Used to copy stashed design assets into the spec's `design/` folder after the spec scaffold creates it.

**Steps:**

1. Read the session variable `STASH_DIR` set by `STAGE_DESIGN_ASSETS`. If unset or empty, return immediately (no stash was created).
2. Verify the spec directory exists: `.planr/specs/SPEC-NNN-${SLUG}/design/`. If not, this procedure was called too early — abort with: `⚠ RESTORE_DESIGN_ASSETS called before spec scaffold. State error.`
3. **Copy** (not move) every file from `STASH_DIR` into `.planr/specs/SPEC-NNN-${SLUG}/design/`. Flatten any nested folders (e.g., `Designs/inbox.png` → `design/inbox.png`).
4. Verify each expected file landed (file count and sizes match the stash).
5. Delete `STASH_DIR` only after the verification passes.
6. Print:

   ```
   ✓ Restored N design asset(s) to .planr/specs/SPEC-NNN-${SLUG}/design/
   ```

**On scaffolder failure path:** if `SCAFFOLD_NODE` aborts after `STAGE_DESIGN_ASSETS` but before the spec scaffold exists, the recovery flow is to **move** (not copy) the stash back to the original locations in the project root, then delete the stash dir. This restores the pre-pipeline state cleanly with no half-state.

---

### Phase A verification gate (mark TodoWrite item 1 complete)

Before continuing to Phase B, verify on disk:

- [ ] If strategy was `ASK_MANUAL` or `ASK_STACK`: command should already have stopped — do NOT continue.
- [ ] If strategy was `CONTINUE`: `.planr/config.json` exists, `input/tech/stack.md` exists or self-heals in Step 1.
- [ ] If strategy was `BOOTSTRAP_ONLY`: `.planr/config.json` exists, `.planr/specs/` exists, `input/tech/` exists.
- [ ] If strategy was `SCAFFOLD_NODE`: `package.json` exists at the project root, `.planr/config.json` exists, `input/tech/stack.md` exists.

If any check fails, the strategy did not complete. Re-run the missing steps before proceeding to Phase B. Do NOT proceed to Step 1 with a half-built Phase A state.

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
6. **Restore staged assets and copy any other referenced PNG mockups** into `<SPEC_DIR>/design/`:
   - **First**, if a stash exists from `STAGE_DESIGN_ASSETS` (Step 0.9), invoke `RESTORE_DESIGN_ASSETS` (Step 0.10) now. This is the moment the spec's `design/` folder exists, so this is the correct restore point.
   - **Then**, for any additional PNGs referenced by `BRIEF` that were NOT in the stash, copy them into `<SPEC_DIR>/design/` using the path expansion rules from Step 0.2 (no silent dangerous fallback). If a referenced PNG doesn't exist, log it and continue (designer-agent will skip silently).
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

### Phase B verification gate (mark TodoWrite item 2 complete)

Before continuing to Phase C, verify on disk:

- [ ] `MODE` is determined and bound (`spec-driven` or `default`)
- [ ] In spec mode: `<SPEC_DIR>/SPEC-NNN-${SLUG}.md` exists and contains substantive Context, Functional Requirements, Business Rules, Acceptance Criteria sections (no remaining `_TODO_` placeholders if `BRIEF` was provided)
- [ ] In default mode: `input/specs/spec-${SLUG}.md` exists and is non-empty
- [ ] `input/tech/stack.md` exists OR a clear self-heal abort message has been printed (Step 1's self-healing path)
- [ ] If a stash from `STAGE_DESIGN_ASSETS` was created, `RESTORE_DESIGN_ASSETS` has run and the stash dir has been deleted

If any check fails, the spec body has not been authored. Re-execute the missing path before proceeding to subagent dispatch. Do NOT dispatch subagents on a half-built spec.

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

- [ ] If `STAGE_DESIGN_ASSETS` ran, `RESTORE_DESIGN_ASSETS` also ran AND the stash dir has been deleted (verify `/tmp/planr-pipeline-stash/<SLUG>-*` no longer exists)

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
| Project root contains unrecognized non-asset files (SCAFFOLD_NODE) | Abort at SCAFFOLD_NODE step 3, suggest cleanup |
| Spec missing (default mode, no BRIEF) | Abort at Step 1, suggest creating `input/specs/spec-${SLUG}.md` or `planr spec init` |
| `stack.md` missing (default mode) | Abort at Step 1, suggest copying from `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl` |
| Scaffolder fails (SCAFFOLD_NODE) | Run `RESTORE_DESIGN_ASSETS` for cleanup; abort with underlying error |
| db-agent fails (connection) | Continue without schema, flag in summary |
| designer-agent fails (corrupt PNG) | Continue without design-spec, flag in summary |
| specification-agent fails | Abort, surface the subagent error; Phase C gate fails |
| Completion Contract checkbox fails | Continue executing missing steps; do not print success |

---

*Reads: spec, stack, ui PNGs, db env vars*
*Writes (default mode): `output/db/schema.json`, `output/feats/feat-{name}/`*
*Writes (spec-driven mode): `output/db/schema.json`, `.planr/specs/SPEC-NNN-{slug}/{design,stories,tasks}/`*
*Does NOT chain to DEV Phase — pipeline stops here for human review (per `${CLAUDE_PLUGIN_ROOT}/docs/rules.md` R1)*

**Bridge to planr CLI:** when `.planr/config.json` declares spec mode, the pipeline reads from `.planr/specs/` directly with no conversion. See `${CLAUDE_PLUGIN_ROOT}/README.md` for the integration story.
