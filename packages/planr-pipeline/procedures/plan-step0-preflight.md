# Procedure: `/planr-pipeline:plan` — Step 0 + Phase A gate

Executed from `commands/plan.md`. This file contains the Step 0 state machine (including parsing `SLUG` / `BRIEF` from `$ARGUMENTS`) plus the Phase A verification gate.

---

### 0.0a — Strip `$ARGUMENTS` flags (`--dry-run`)

Run **before** **§ 0.0**:

1. Tokenize `$ARGUMENTS`.
2. Remove every `--dry-run` occurrence.
3. If any removals happened, bind `PLAN_DRY_RUN=true`; else `PLAN_DRY_RUN=false`.
4. Rejoin leftover tokens (**preserving intra-brief wording**) into **`$ARGUMENTS`** for **§ 0.0 onward**.

*(If leftovers are empty, **§ 0.0 will trigger the usual missing-slug guard**.)*

### 0.0 — Sanitize `$ARGUMENTS` (defensive)

Before remaining Step 0 processing, validate that `$ARGUMENTS` is a sane invocation:

- If `$ARGUMENTS` exceeds **12,000 characters**, abort with: `⚠ $ARGUMENTS is unexpectedly long (>12000 chars). This usually means a previous conversation was accidentally pasted in. Re-invoke with: /planr-pipeline:plan {slug} {brief}`
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

If `PLAN_DRY_RUN=true`, **skip** this section entirely (**`--dry-run`** provides the authoritative read-only `/plan` preview — continue at **§ 0.4**).

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

### 0.5b — `--dry-run` STOP (mandatory shortcut)

When `PLAN_DRY_RUN=true`:

1. Execute `${CLAUDE_PLUGIN_ROOT}/procedures/plan-dry-run-preview.md`.
2. **STOP** immediately — skip **§ 0.6**, skip **§ Phase A verification gate**, skip `plan-step1-*` / `plan-steps-*` for this invocation.
3. Mark orchestrator task-tracker items **2–4** as `cancelled` with reason **`dry-run exit`**.

*(Real runs (`PLAN_DRY_RUN=false`) continue to § 0.6 as before.)*

### 0.6 — Execute the chosen strategy

Follow **exactly one** procedure end-to-end. Do not duplicate strategy bodies in this command:

| Strategy | Procedure |
|---|---|
| `CONTINUE` | `${CLAUDE_PLUGIN_ROOT}/procedures/strategy-continue.md` |
| `BOOTSTRAP_ONLY` | `${CLAUDE_PLUGIN_ROOT}/procedures/strategy-bootstrap-only.md` |
| `SCAFFOLD_NODE` | `${CLAUDE_PLUGIN_ROOT}/procedures/strategy-scaffold-node.md` |
| `ASK_MANUAL` | `${CLAUDE_PLUGIN_ROOT}/procedures/strategy-ask-manual.md` |
| `ASK_STACK` | `${CLAUDE_PLUGIN_ROOT}/procedures/strategy-ask-stack.md` |

For `BOOTSTRAP_ONLY` and `SCAFFOLD_NODE`, the common sub-procedures `WRITE_PLANR_DIRS` (`${CLAUDE_PLUGIN_ROOT}/procedures/write-planr-dirs.md`) and `AUTHOR_STACK_FROM_BRIEF` (`${CLAUDE_PLUGIN_ROOT}/procedures/author-stack-from-brief.md`) are standalone procedures both strategies invoke.

---

### Phase A verification gate (mark task-tracker item 1 complete)

If **`PLAN_DRY_RUN=true`**, § **0.5b** already terminated — **do not** evaluate these checks.

Before continuing to Phase B, verify on disk:

- [ ] If strategy was `ASK_MANUAL` or `ASK_STACK`: command should already have stopped — do NOT continue.
- [ ] If strategy was `CONTINUE`: `.planr/config.json` exists, `input/tech/stack.md` exists or self-heals in Step 1.
- [ ] If strategy was `BOOTSTRAP_ONLY`: `.planr/config.json` exists, `.planr/specs/` exists, `input/tech/` exists.
- [ ] If strategy was `SCAFFOLD_NODE`: `package.json` exists at the project root, `.planr/config.json` exists, `input/tech/stack.md` exists.

If any check fails, the strategy did not complete. Re-run the missing steps before proceeding to Phase B. Do NOT proceed to Step 1 with a half-built Phase A state.
