# Planr CLI Reference

> Complete command reference for the `planr` CLI tool.
> Package: `openplanr` | Binary: `planr` (alias: `opr`)

---

## Installation

```bash
npm install -g openplanr

# Verify
planr --version
```

---

## Agent-Friendly / Non-Interactive Mode

Planr auto-detects non-TTY environments (CI, coding agents) and skips interactive prompts by using sensible defaults. You can also opt in explicitly:

```bash
# Explicit flag
planr epic create --title "My App" --yes
planr task create --story US-001 --title "Implement approved story" --yes

# Auto-detected (no TTY)
echo "" | planr epic create --title "My App"
```

**Behavior in non-interactive mode:**

- Confirmations return their default value (usually `yes`)
- Select menus pick the first/primary option (e.g., "Save" for epics)
- All skipped prompts are logged with `[auto]` prefix in dim output

---

## Global Options

These options apply to **all** commands:

| Flag                   | Description                             | Default           |
| ---------------------- | --------------------------------------- | ----------------- |
| `--project-dir <path>` | Set project root directory              | Current directory |
| `--verbose`            | Enable verbose output                   | `false`           |
| `--no-interactive`     | Skip interactive prompts (use defaults) | `false`           |
| `-y, --yes`            | Auto-accept all prompts (alias for `--no-interactive`) | `false` |
| `-V, --version`        | Print version                           | —                 |
| `-h, --help`           | Show help                               | —                 |

---

## Commands

### `planr company` (pre-release)

The company route connects an explicitly configured workspace to selected local artifacts. Existing encrypted token shares remain separate. Sign in through the browser and choose the organization in the identity provider's consent screen:

```bash
planr company login --api-url https://api.example.com --json
# Print the browser URL instead of launching it; open it on this same computer
planr company login --api-url https://api.example.com --no-open --timeout 300 --json
planr company logout --api-url https://api.example.com --json
```

The API advertises its configured public OAuth client through `/.well-known/openplanr-company-auth`. The CLI uses authorization-code/S256 PKCE, a temporary `127.0.0.1` callback, issuer/state validation and discovered same-origin token endpoints. A client secret is never required. This follows [Clerk's CLI pattern](https://clerk.com/blog/adding-clerk-auth-to-your-cli) and [OAuth configuration contract](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth). Public-client registration and live acceptance are deployment setup; the command never registers clients automatically.

Access tokens renew before their returned expiry, with refreshes serialized across CLI processes. Token generations live in the existing OS keychain or encrypted local credential backend; the result discloses the backend. Private metadata pins that backend and supports recovery if token storage succeeds before an interrupted metadata update. An uncertain exchange never automatically reuses a possibly consumed refresh token. Sign out and sign in again when renewed authorization cannot be recovered.

Logout revokes saved refresh and access tokens before removing their local references. A remote failure preserves disabled credentials for retry. `--local-only` intentionally skips remote revocation. Partial or unknown revocation is reported when an interrupted exchange could have issued an unavailable token; review the application authorization in the identity provider. Credential-cleanup failure also remains visible and retryable. Logout does not sign out the browser. `PLANR_COMPANY_TOKEN` and `company connect --token-stdin` are explicit developer fallbacks, with no automatic renewal; an environment override must be unset separately. Never put tokens in command arguments or chat.

Publication selects one repository-relative JSON, Markdown, SVG or HTML file, up to 1 MiB. An authored `openplanr-design-document` selected with `--kind design` packages the complete design: its declared screens, frames, variants, and supported local assets. The entire packaged revision must fit within the same 1 MiB limit. Single HTML/SVG designs remain supported.

```bash
planr company preview .planr/designs/checkout/design-document.json \
  --kind design --title "Checkout experience" \
  --api-url https://api.example.com --project <project-id>
planr company publish <preview-id> --json
```

Review the exact selected files, content and publication size before publishing. `--json` includes the complete content for inspection; the default design preview gives a compact file list and screen/frame/variant counts. Source hashes are stored in private local state. Publication rebuilds the package and refuses any changed source or newly referenced file until a fresh preview is reviewed. No directory scan, render cache, or unrelated repository content is published.

The returned binding remembers its source document and accepted remote revision. `company push <binding-id> --preview` rebuilds the design package and lists the selected files; `company push <binding-id>` publishes that exact reviewed update against the bound base. Each later expansion of referenced content needs a fresh preview. See `planr company --help` for connection and publication options.

Company publication retries preserve their original IDs and return `already-published` when completing from saved receipts. `synchronization: "not-checked"` means the current remote head has not been read; run `planr company status <binding-id>` before describing the workspace as synchronized.

Read-only retrieval uses an existing publication binding:

```bash
planr company status <binding-id> --json
planr company pull <binding-id> --preview --json
planr company pull <binding-id> --json

# Intentionally inspect a historical immutable revision
planr company pull <binding-id> --preview --revision <revision-id> --json
planr company pull <binding-id> --json
```

The preview reports the selected revision, digest, byte size, content, and whether local or remote content has changed. Pull verifies authorization and exact bytes again, then saves an inert `.txt` copy under `.local/company/remote-content/` with a retrieval receipt. It does not replace the repository file, advance the accepted binding, apply a proposal, or resolve feedback. Divergent or missing local files remain untouched. A changed local file or latest remote head requires a fresh preview. An explicitly selected historical revision stays pinned even if newer revisions appear.

Retrieved content is untrusted input, including HTML and SVG. Inspect it as data. `company proposal` previews typed changes; `company apply` is a separate explicit local action, currently limited to validated canonical diagram JSON. Packaged designs are retrieved as inert review copies and cannot be applied over authored design documents; edit their source files locally and use a reviewed company push instead. A successful application records `applied-locally` with remote acknowledgement pending. Preserve local backups and recovery journals, and retry the same application after interruption. These development commands do not establish enterprise production readiness.


---

### Deterministic planning artifacts

Initialize project-local storage, then create planning artifacts from explicit flags or a JSON object:

```bash
planr init --name "my-project"
planr epic create "Platform renewal"
planr feature create "OAuth sign-in" --epic EPIC-001
planr story create "Sign in with the company identity provider" --feature FEAT-001
planr task create "Implement approved sign-in flow" --story US-001
planr quick create "Fix the callback error"
planr backlog add "Add callback rate limits" --priority high --tag security
planr sprint create "Sprint 1" --duration 2w
```

Every planning type provides `list`, `show <id>`, and `update <id>`. Creation accepts `--title`, `--data <path>` (or `-` for stdin), the deprecated `--file` alias, and `--json`. Parent IDs may be supplied by flags or JSON:

| Artifact | Required relationship or fields |
| --- | --- |
| Epic | A title |
| Feature | A title and `--epic <id>` |
| Story | A title and `--feature <id>` |
| Task | A title and exactly one of `--story <id>` or `--feature <id>` |
| Quick task | A description or input file; optional `--epic <id>` |
| Backlog item | A description; optional priority, tags, and epic |
| Sprint | A title; duration defaults to `2w` |

Use deterministic JSON when an agent or integration supplies complete fields:

```bash
planr epic create --data epic.json --json
planr feature create --data feature.json --json
planr task create --data - --json < task.json
```

`planr update <ids...>` supports bulk status changes. `--all-done` and `--all-pending` also update canonical task checkboxes for task and quick-task artifacts. Use each command's `--help` output for its exact options.


### `planr spec`

Spec-driven planning mode — third posture alongside agile + QT, designed for **planning *for* AI coding agents**. Each spec is a self-contained directory at `.planr/specs/SPEC-NNN-{slug}/` containing the spec doc, decomposed User Stories, decomposed Tasks, and any UI design assets. The artifact schema mirrors the [planr-pipeline](https://github.com/openplanr/OpenPlanr/tree/main/packages/pipeline) canonical protocol schemas under `schemas/v1.0.0/` — file Create/Modify/Preserve lists, Type=UI|Tech, agent assignment, DoD with build/test commands. The two products use one artifact contract; no conversion adapter ever.

The generated artifact contract and command examples in this section are the
packaged source of truth for spec-driven mode.

#### `planr spec init`

Activate spec-driven mode in the current project. Creates `.planr/specs/`. Adds `spec: SPEC` to `idPrefix` if missing. Idempotent.

```bash
planr spec init
```

---

#### `planr spec create`

Create a new spec — a self-contained directory with `stories/`, `tasks/`, `design/` subfolders.

```bash
planr spec create "Auth flow"
planr spec create --title "Auth flow" --slug auth --priority P0 --milestone v1.0
planr spec create "User Onboarding" --po @AsemDevs
```

| Option              | Description                                            | Required     |
| ------------------- | ------------------------------------------------------ | ------------ |
| `<title>` (positional) | Spec title (alternative to `--title`)               | No (one of `<title>` or `--title`) |
| `--title <str>`     | Spec title                                             | No           |
| `--slug <slug>`     | Explicit kebab-case slug; otherwise derived from title | No           |
| `--priority <p>`    | `P0` / `P1` / `P2` (default: `P1`)                     | No           |
| `--milestone <m>`   | Milestone label (e.g., `v1.0`)                         | No           |
| `--po <handle>`     | Product Owner handle                                   | No           |

**Output:** `.planr/specs/SPEC-NNN-{slug}/SPEC-NNN-{slug}.md` (plus empty `stories/`, `tasks/`, `design/` subdirs).

---

#### `planr spec shape`

Interactive 4-question authoring of a spec's body. Walks the PO through Context, Functional Requirements, Business Rules, and Acceptance Criteria. Optionally captures Out-of-Scope items and Decomposition Notes. Updates `status: pending → shaping`.

```bash
planr spec shape SPEC-001
```

**Refused in `--no-interactive` mode** — this command is interactive by design (it asks 4 sequential questions).

| Behavior | Detail |
| --- | --- |
| Question 1 | Context (opens your `$EDITOR`) |
| Question 2 | Functional Requirements (comma-separated) |
| Question 3 | Business Rules / Constraints (optional, opens `$EDITOR`) |
| Question 4 | Acceptance Criteria (comma-separated) |
| Optional | Out-of-Scope items + Decomposition Notes |
| Output | Regenerates `SPEC-NNN-{slug}.md` body from answers; preserves frontmatter (priority, milestone, po, ui_files) |

---

#### `planr spec sync`

Validate spec integrity and auto-fix safe inconsistencies. Use after manual edits, interrupted work, or when in doubt.

```bash
planr spec sync                       # scan all specs
planr spec sync SPEC-001              # scope to one spec
planr spec sync --dry-run             # report findings without writing fixes
```

| Option        | Description                                          | Required |
| ------------- | ---------------------------------------------------- | -------- |
| `[specId]`    | Optional spec ID to scope; default: scan all         | No       |
| `--dry-run`   | Report findings without writing fixes                | No       |

**Detection rules:**
1. **Orphaned task** — `task.storyId` points to a non-existent US in the same spec → WARN (don't auto-delete; user reviews)
2. **Story without tasks** — decomposition incomplete → WARN
3. **Missing `specId` frontmatter** on US/Task files → AUTO-FIX (insert from path)
4. **Schema version drift** — artifact's `schemaVersion` older than current → WARN (no auto-migration in v1)

---

#### `planr spec list`

List all specs with title, status, and decomposition counts.

```bash
planr spec list
```

---

#### `planr spec show`

Print a spec's metadata, body summary, and the full US/Task decomposition tree.

```bash
planr spec show SPEC-001
```

---

#### `planr spec status`

Decomposition state. Without args: aggregate report across all specs. With a spec ID: focused view.

```bash
planr spec status                # aggregate
planr spec status SPEC-001       # focused
```

---

#### `planr spec destroy`

Remove a spec entirely. Because each spec is a self-contained directory, this is a single `rm -rf`. Prompts for confirmation (use `--yes` to skip).

```bash
planr spec destroy SPEC-001
planr spec destroy SPEC-001 --yes
```

---

#### `planr spec attach-design`

Copy PNG mockup files into the spec's `design/` subdirectory and update
`ui_files` frontmatter on the SPEC. The `planr:plan` host skill reads these
inputs while it builds the reviewed implementation plan.

```bash
planr spec attach-design SPEC-001 --files login.png signup.png
```

---

#### `planr spec promote`

Validate that a spec is ready for handoff to `planr-pipeline` (has stories, tasks, non-trivial body) and print the next-step pipeline command. Updates SPEC frontmatter `status: ready-for-pipeline`.

```bash
planr spec promote SPEC-001
```

After promotion, run from any configured runtime:

```text
/planr:plan       # Claude Code
$planr:plan       # Codex
```

---

### `planr template list`

List all available task templates (built-in and custom).

```bash
planr template list
```

Shows template name, description, task count, and whether it's built-in or custom.

---

### `planr template show`

Preview a template's contents and variables.

```bash
planr template show rest-endpoint
```

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `<name>` | Template name | **Yes**  |

---

### `planr template use`

Generate a task list from a template with variable substitution.

```bash
planr template use rest-endpoint --title "User Profile API"
planr template use react-component --title "Dashboard Widget"
```

| Argument/Option   | Description                       | Required |
| ----------------- | --------------------------------- | -------- |
| `<name>`          | Template name                     | **Yes**  |
| `--title <title>` | Title for the generated task list | **Yes**  |

Template variables (e.g., `{{entityName}}`, `{{componentName}}`) are prompted interactively during generation.

**Built-in templates:**

| Template             | Description                                            | Variables                        |
| -------------------- | ------------------------------------------------------ | -------------------------------- |
| `rest-endpoint`      | CRUD endpoint with validation, auth, tests, docs       | `entityName`, `basePath`         |
| `react-component`    | Component, stories, tests, types                       | `componentName`                  |
| `database-migration` | Schema change, migration, rollback, seed data          | `tableName`, `changeDescription` |
| `api-integration`    | External API client, retry logic, error handling       | `serviceName`, `baseUrl`         |
| `auth-flow`          | Authentication flow with login, signup, password reset | `authProvider`                   |

**Output:** `.planr/tasks/TASK-001-<slug>.md`

---

### `planr template save`

Save an existing task list as a reusable custom template.

```bash
planr template save TASK-001 --name my-pattern
```

| Argument/Option | Description                      | Required |
| --------------- | -------------------------------- | -------- |
| `<taskId>`      | Task list ID to save as template | **Yes**  |
| `--name <name>` | Template name                    | **Yes**  |

**Output:** `.planr/templates/<name>.json`

---

### `planr template delete`

Remove a custom template.

```bash
planr template delete my-pattern
```

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `<name>` | Template name | **Yes**  |

Prompts for confirmation before deleting. Only custom templates can be deleted.

---

### `planr checklist show`

Display the agile development checklist.

```bash
planr checklist show
```

Shows the full 5-phase checklist:

1. Requirements Analysis
2. Technical Design
3. Architecture Decision Records
4. Solution Planning
5. Solution Review

---

### `planr checklist toggle`

Interactively toggle checklist items. Presents a multi-select prompt where you can check/uncheck items, then writes changes back to the file with a progress summary.

```bash
planr checklist toggle
```

---

### `planr checklist reset`

Reset the checklist back to its initial state.

```bash
planr checklist reset
```

---

### `planr init`

Initialize deterministic project storage in `.planr/`. Runtime installation belongs to `planr setup`.

```bash
planr init
planr init --name my-project
planr init --force
```

| Option | Description |
| --- | --- |
| `--name <name>` | Project name; defaults to the current directory name |
| `--force` | Replace an existing project configuration intentionally |

---

### `planr setup`, `planr runtime`, and `planr doctor`

```bash
planr setup
planr setup --runtime auto --scope user --yes
planr setup --dry-run
planr setup --minimal
planr runtime detect
planr runtime install codex --scope user
planr runtime update claude --scope user
planr runtime rollback
planr doctor --strict
```

Interactive setup guides workflow, runtime, and scope selection. User scope is
the default; project scope requires a Git worktree or initialized OpenPlanr
project. Setup previews mutations, backs up existing bytes, preserves content
outside managed markers, writes `.planr/runtime-lock.json` only for project
installations, and is idempotent. `--minimal` keeps only the dedicated planning CLI.

For user-scoped Claude Code setup, the preview also lists external marketplace
and plugin operations. After confirmation, setup refreshes
`openplanr/marketplace` and installs or updates `planr@openplanr` to the
version compatible with this CLI.
`planr doctor` checks those versions and each plugin's stable manifest identity
without mutating Claude Code. `doctor --fix` never changes plugin packages.
Restart Claude Code when setup or `runtime update` reports a plugin change.

Use the corresponding `planr:*` skills through the installed runtime adapter.
Semantic workflows are not duplicated as utility CLI commands.

### `planr operate`

The public Operate namespace supports two distinct products. The installed
`$planr-operate` skill runs a guidance-first local seven-lens review with no
named-owner, receipt, evidence-ledger, or blocking-validation prerequisite.
Its optional note checker reports bounded structural diagnostics:

```bash
planr operate validate-note <note.md> --profile advisor|challenger|chair|board-report --contract-version 2.0.0 --json
```

Diagnostics are editing help. Missing or malformed lens output remains a
visible issue with its impact and next action; it does not discard other useful
findings or force a correction loop. `--contract-version auto` is the default;
it detects declared or structurally identifiable v1 and v2 Markdown notes.

The other `planr operate` commands expose the durable Protocol 2.0 stateful
runtime. For that interface, first discover the installed domains. The command
returns canonical `domainId`/`domainVersion` pairs and registered roles without
opening project runtime storage:

```bash
planr operate domains --json
```

Pass one exact returned identity to Cycle start. Do not substitute the protocol
version for the domain version.

```bash
planr operate start \
  --scope <scopeId> \
  --domain <domainId> \
  --domain-version <domainVersion> \
  --owner <humanActorId> \
  --route observe-only \
  --json
```

Codex full setup installs every canonical, manifest-owned `planr-*` skill in the Protocol registry.
The durable runtime's issued executors use this file-based packet protocol only:

```bash
planr operate assignment prepare <assignmentId> --actor <agentId> --runtime codex --json
planr operate assignment validate <packetId> --content-file <resultPath|-> --json
planr operate assignment submit <packetId> --content-file <resultPath|-> --json
```

`prepare` claims idempotently and returns the exact packet paths. `validate`
reports bounded schema and semantic failures with JSON pointers. `submit`
derives claimant and custody from the packet and accepts exact file or stdin
bytes. The diagnostic `claim`, `artifact`, and low-level `submit` commands are
not part of the generated executor workflow.

Useful read-only and recovery surfaces:

| Command | Purpose |
| --- | --- |
| `planr operate cycle <cycleId> --actor <humanActorId> --json` | Read the exact owner-bound Cycle experience |
| `planr operate dashboard <cycleId> --actor <humanActorId>` | Open the loopback dashboard |
| `planr operate recovery storage-status --json` | Inspect neutral storage and migration status |
| `planr operate assignment recover --json` | Clear only runtime-confirmed abandoned packets |

Failures from packet commands are bounded in both human and `--json` output;
machine output contains `ok`, `code`, and `problem` without stack traces or host
paths. For setup or command parity failures, run `planr doctor --strict --json`.
Use `planr upgrade status`, then `planr upgrade apply` when doctor reports an
incompatible installed CLI.

### `planr artifact`

Open, share, import, and export universal HTML review sessions:

```bash
planr artifact <file>
planr artifact open <file> [--title <title>] [--root <asset-root>] [--theme auto|light|dark] [--presentation auto|document|canvas] [--port <port>] [--no-open] [--json]
planr artifact share <file> [--title <title>] [--root <asset-root>] [--presentation auto|document|canvas] [--snapshot] [--short] [--ttl 1d|7d|30d] [--secret-output <private-file>] [--no-open] [--json] [--yes]
planr artifact import <review-url>... [--output <path>] [--allow-stale] [--json] [--yes]
planr artifact export <session-id> [--format json|markdown] [--output <path>]
```

When `--root` is omitted, the artifact file's directory is the asset root. This
makes `planr artifact share /absolute/path/to/artifact.html` work without
changing directories or supplying a redundant root. Supported public HTTPS
dependencies are bundled into the immutable artifact automatically; runtime
network access remains blocked in the review sandbox.

Local sessions bind only to loopback. Sharing is never automatic. New generic
shares create an encrypted live review room with three separate authorities:
the review URL can comment, the owner-verdict URL plus its matching private
signer can decide, and the management URL can pause/reopen comments or delete
the room but cannot decide. Live rooms require `--secret-output`; before any
network request, the CLI makes an exact recovery bundle durable at mode 0600
with all three URLs and the owner signer. A lost response retries the same
prepared room once. Definite no-effect rejection revokes the bundle, while an
ambiguous outcome retains it and emits only a bounded, path-free recovery
error. `--snapshot` selects the older immutable fragment/short-link flow;
encrypted short links default to a seven-day expiry.
See [Artifact review and private sharing](ARTIFACT_REVIEW.md)
for the sandbox, privacy, remote/SSH, stale-review, offline, and self-hosting
contracts.

`--presentation auto` is the default. One generic artifact resolves to the
headless `document` page; multi-variant and design-board reviews use `canvas`.
Explicit `document` or `canvas` overrides the inference, and JSON output reports
the resolved value. Artifact review bundles source and runs it inside an
invisible opaque-origin Blob sandbox; it is not standalone website publishing.

---

### `planr rules generate`

Generate AI agent rule files for Cursor, Claude Code, and/or Codex. Two flags: **`--target`** (which runtime) and **`--scope`** (which workflow — agile or pipeline).

```bash
planr rules generate                                       # all targets, agile scope (default)
planr rules generate --target cursor                       # cursor only, agile scope
planr rules generate --target cursor --scope pipeline      # cursor pipeline rules (Cursor adapter for planr-pipeline)
planr rules generate --target codex --scope pipeline       # AGENTS.md with pipeline orchestration section
planr rules generate --target all --scope all              # everything for everyone
planr rules generate --dry-run                             # preview without writing
```

| Option              | Description                                       | Default |
| ------------------- | ------------------------------------------------- | ------- |
| `--target <target>` | `cursor`, `claude`, `codex`, or `all`             | `all`   |
| `--scope <scope>`   | `agile`, `pipeline`, or `all`                     | `agile` |
| `--dry-run`         | Show what would be generated                      | `false` |

**`--scope agile` (default — preserves existing behaviour):** generates the agile-mode rules for epic → feature → story → task workflows.

**`--scope pipeline`:** generates rule files that drive the [planr-pipeline](https://github.com/openplanr/OpenPlanr/tree/main/packages/pipeline) two-phase spec-driven workflow on the chosen runtime. Cross-runtime parity with the Claude Code plugin.

**Generated files by `target × scope`:**

| Target × Scope          | Output                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `cursor` × `agile`      | `.cursor/rules/{agile-checklist,create-epic,create-features,create-user-story,create-task-list,implement-task-list}.mdc` (6 files) |
| `cursor` × `pipeline`   | `.cursor/rules/openplanr.mdc` + `openplanr-roles/{9 role files}.md` + deprecation aliases |
| `claude` × `agile`      | `CLAUDE.md` (agile context-gathering protocol)                                                                |
| `claude` × `pipeline`   | `CLAUDE.md` (with pipeline block) + sibling `planr-pipeline.md` reference card                            |
| `codex` × `agile`       | `AGENTS.md` (agile context)                                                                                   |
| `codex` × `pipeline`    | Concise `AGENTS.md` project policy; `planr setup` installs user-scope workflow skills |
| `* × all`               | Both scopes side-by-side                                                                                      |

**Cross-runtime support:** v1.0 artifacts plus v1.1 capability contracts run on
Claude Code, Cursor, and Codex. Codex uses skills and native subagents when exposed;
Cursor uses Composer handoff with sequential fallback.

---

### `planr sync`

Validate and repair cross-references across all artifacts.

```bash
planr sync                          # fix broken cross-references
planr sync --dry-run                # preview changes without writing
```

| Option      | Description                                  | Default |
| ----------- | -------------------------------------------- | ------- |
| `--dry-run` | Show what would change without writing files | `false` |

**What it checks:**

- **Stale links:** Parent links to a child file that doesn't exist on disk
- **Missing links:** Child references a parent, but parent doesn't list the child
- **Duplicates:** Same child linked more than once in a parent

Handles both story-level and feature-level task relationships.

---

### `planr status`

Show project planning progress with tree view, completion metrics, and color-coded progress.

```bash
planr status
planr status --all
```

| Option  | Description                       | Default                                  |
| ------- | --------------------------------- | ---------------------------------------- |
| `--all` | Show all items without truncation | `false` (truncates to 5 items per level) |

**Features:**

- Tree view grouping: epics → features → stories
- Task completion metrics: `(8/24 subtasks, 33%)`
- Color-coded progress: green (>75%), yellow (25-75%), red (<25%)
- Overall completion summary across all task lists
- Unlinked artifact detection (features/stories without parents)

---

### `planr graph`

Emit the OpenPlanr artifact graph. `--json` is the stable machine-readable
contract consumed by `planr-pipeline` dashboard and ecosystem conformance.

```bash
planr graph --json
```

| Option   | Description                         | Default |
| -------- | ----------------------------------- | ------- |
| `--json` | Output `{ nodes, edges }` as JSON   | `false` |

The JSON output follows `planr-pipeline/schemas/v1.0.0/graph.schema.json`.

---

### `planr config show`

Display the current deterministic project configuration.

```bash
planr config show
```

---

### `planr config set-agent`

Set the default coding agent for task implementation guidance.

```bash
planr config set-agent                   # interactive prompt
planr config set-agent cursor            # set directly
```

| Argument  | Description                    | Required     |
| --------- | ------------------------------ | ------------ |
| `[agent]` | `claude`, `cursor`, or `codex` | No (prompts) |

---

### `planr linear init`

Authenticate to [Linear](https://linear.app) with a personal access token, then allow one, several, or all accessible teams. When several teams are enabled, choose the default used by commands that omit `--team`. OpenPlanr saves the allowed `linear.teams` plus the backward-compatible default `linear.teamId` and `linear.teamKey` in `.planr/config.json`. The token is stored via the credentials service (or the `PLANR_LINEAR_TOKEN` environment variable) and is never written into `config.json`.

```bash
planr linear init
```

`planr linear push <artifact> --team <id-or-key>` targets any team selected during init. A push always targets one team; OpenPlanr does not duplicate an artifact across every team because each artifact has one authoritative Linear linkage.

### `planr linear sync`

**Two steps in one command:** (1) **bidirectional workflow status sync** for every Feature, Story, Quick task, and Backlog item with a `linearIssueId` — three-way merge between local frontmatter, Linear's workflow state, and a stored baseline; (2) run **task checklist** sync (`TASK-*.md` ↔ Linear) for all task files that share a `linearIssueId` (see `planr linear tasklist-sync`). Use `--verbose` to log per-artifact work.

```bash
planr linear sync
planr linear sync --dry-run
planr linear sync --on-conflict linear
planr --verbose linear sync
```

| Option | Description |
| ------ | ----------- |
| `--dry-run` | Read from Linear to compare, but do **not** write local frontmatter or Linear issue bodies. |
| `--on-conflict` | `prompt` (default), `local`, or `linear`. Applies to **both** status and checkbox conflicts. Non-interactive runs default to `linear` regardless of flag. |

**Three-way status merge**

Each artifact's status decision considers three values: `local` (current frontmatter), `remote` (Linear's current workflow state, mapped), and `base` (the last-synced value, stored in `linearStatusReconciled`). Outcomes:

| Situation | Action |
|---|---|
| `local == remote` | No change (`unchanged` counter). |
| `base == local` and `local != remote` | Linear changed since last sync → **pull** to local. |
| `base == remote` and `local != remote` | Local changed since last sync → **push** to Linear. |
| Both diverged from `base` (or `base` missing and they disagree) | **Conflict** → resolve per `--on-conflict`. |
| Backlog local is `promoted` | Never overwritten (`promoted` is local-only and implies a target pointer Linear can't know about). |

`planr quick update --status <v>` and `planr backlog update --status <v>` automatically clear `linearStatusReconciled` so the next sync sees a local change and pushes it up.

**Status sync coverage**

| Artifact | Local values | Bidirectional sync |
|---|---|---|
| feature / story | `planning` · `in-progress` · `done` | ✅ |
| quick (`QT-`) | `pending` · `in-progress` · `done` | ✅ |
| backlog (`BL-`) | `open` · `closed` · `promoted` | ✅ (never auto-overwrites `promoted`) |
| task (`TASK-`) | `pending` · `in-progress` · `done` (per-file) | ✅ push (aggregated to merged TaskList issue); pull deferred — see below |

**TASK aggregation on push.** A single Linear TaskList issue aggregates every `TASK-NNN.md` file under one feature (one issue, multiple checkbox lists merged). `planr linear push` resolves a single workflow stateId for that issue using the rule:

| Local task-file statuses | Linear TaskList state |
|---|---|
| All `done` | Done (`completed`) |
| Any `in-progress` | In Progress (`started`) |
| Mix of `done` + `pending` (no in-progress) | In Progress (`started`) — work has begun |
| All `pending` | Todo (`unstarted`) |

The `--all-done` flag on `planr task update` (see above) is the recommended path: flipping every checkbox in a task file to `[x]` and setting `status: done` makes the next `planr linear push FEAT-XXX` move the merged TaskList issue to Done.

**Pull-side TASK propagation** (Linear → all task files under feature) is tracked separately — partial-disagreement guards aren't trivial. `planr linear tasklist-sync` continues to handle per-checkbox sync as today.

**Baseline frontmatter fields** (written by sync, optional; missing = no prior sync):

- `linearStatusReconciled: "done"` — the last agreed-upon status.
- `linearStatusSyncedAt: "2026-04-23T12:34:56Z"` — ISO timestamp of the last sync.

**Audit log.** Non-interactive conflict auto-resolutions are recorded to `.planr/reports/linear-sync-conflicts-<date>.md` (same file as checkbox conflicts; each row tagged with `kind: status` or `kind: checkbox`).

**Estimate sync**

`planr linear push` also writes an artifact's reviewed `estimatedPoints` or `storyPoints` to Linear's native Issue estimation field, per the team's configured scale:

| Team scale | Behavior |
|---|---|
| `fibonacci` | local values snap to nearest of `{0, 1, 2, 3, 5, 8, 13, 21}`; e.g. `4 → 5`, `7 → 8` |
| `linear` | snap to `{0, 1, 2, 3, 4, 5}` |
| `exponential` | snap to `{0, 1, 2, 4, 8, 16}` |
| `tShirt` | skipped (no reliable numeric → XS/S/M/L/XL mapping); one-per-run warning |
| `notUsed` | skipped silently |

Applies to FEAT / US / QT / BL pushes. TASK is intentionally out of scope — one Linear TaskList issue aggregates multiple local `TASK-*.md` files (same rationale as the TASK status deferral), so estimate aggregation rules are tracked as a follow-up.

The team scale is auto-detected per push run and cached. Set a reviewed `estimatedPoints: <n>` in the artifact frontmatter, then `planr linear push` sends it.

**Status-name aliases (push side):** values like `completed`, `cancelled`, `canceled`, and `todo` on a QT/feature/story are transparently treated as `done`/`pending` so hand-edited frontmatter using Linear's native vocabulary still works.

**Zero-config auto-derive:** on every push run, `planr linear push` fetches the team's workflow states once and auto-derives a status→stateId map from Linear's canonical state **types** (`backlog` / `unstarted` / `started` / `completed` / `canceled`). You don't need to configure anything for basic status sync to work — the first `pending`/`open` state of each canonical type becomes the default. Configure `linear.pushStateIds` only when you want non-default routing (e.g., push `done` to "Released" instead of the first `completed` state).

**Config:** `linear.statusMap` — keys are Linear state names (e.g. `"Code Review"`), values are one of `pending`, `in-progress`, `done` for tasks/stories/features/QT, or one of `open`, `closed`, `promoted` for BL. `linear.pushStateIds` — local status → Linear workflow state UUID; takes precedence over the auto-derived defaults. For backlog, use `open`/`closed`/`promoted` keys directly (BL has no implicit coercion to the task vocabulary).

```jsonc
{
  "linear": {
    "pushStateIds": {
      "pending":     "uuid-of-Todo",
      "in-progress": "uuid-of-In-Progress",
      "done":        "uuid-of-Done",
      "open":        "uuid-of-Todo",
      "closed":      "uuid-of-Done"
    },
    "statusMap": {
      "In Review": "in-progress"
    }
  }
}
```

### `planr linear status`

**Local only** — no Linear API. Prints a text table: OpenPlanr id, Linear identifier, URL, last-known `status` (or em dash for epics), and a note for malformed or stale `linearIssueId` values (e.g. a workflow state uuid mistaken for an issue id).

```bash
planr linear status
planr linear status --scope EPIC-001
```

### `planr linear push`

Create or update Linear entities for any planning artifact, at the smallest scope the id implies. Accepts any supported prefix — `EPIC-`, `FEAT-`, `US-`, `TASK-`, `QT-`, `BL-` — and writes `linearProject*` / `linearIssue*` / `linearMilestoneId` / `linearLabelId` / `linearProjectMilestoneId` / `linearLabelIds` / `linearTaskChecklistSyncedAt` back to artifact frontmatter. Requires `planr linear init` and a team id in config.

```bash
planr linear push EPIC-001                              # full subtree: project + features + stories + tasklists + linked QT/BL
planr linear push FEAT-015                              # just one feature + its stories + its tasklist
planr linear push US-054                                # just one story
planr linear push TASK-015                              # just one tasklist sub-issue
planr linear push QT-007                                # standalone quick task (or epic-linked if QT has epicId)
planr linear push BL-001                                # backlog item (auto `backlog` label)
planr linear push EPIC-001 --dry-run                    # local preview only; no Linear API calls
planr linear push EPIC-001 --update-only                # only update existing linked entities
planr linear push FEAT-015 --push-parents               # if the parent epic isn't pushed yet, push it first (upward attachment only)
planr linear push FEAT-015 --no-cascade                 # push only this feature — skip its stories and tasklist
planr linear push EPIC-001 --no-cascade                 # push only the epic project — no features
planr linear push TASK-004 --push-parents               # push parent feature (no sibling stories) + this tasklist
planr linear push EPIC-001 --as milestone-of:<projectId># first-time mapping strategy override
```

| Argument / option           | Description                                                                                                                                    | Required |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `<artifactId>`              | Any supported prefix — `EPIC-`, `FEAT-`, `US-`, `TASK-`, `QT-`, `BL-`                                                                          | **Yes**  |
| `--dry-run`                 | Print planned creates/updates/skips from disk; does not read credentials or call Linear                                                        | No       |
| `--update-only`             | Update only objects that already have a Linear id in frontmatter; do not create new project or issues                                          | No       |
| `--push-parents`            | If a parent in the chain is not yet pushed to Linear, push it first — **upward attachment only** (does NOT push the parent's siblings)         | No       |
| `--no-cascade`              | Push only the target artifact (and minimum parent chain when `--push-parents` is set). EPIC/FEAT pushes skip their descendants. No-op for leaves. | No       |
| `--as <strategy>`           | Epic-only: mapping strategy. One of `project` \| `milestone-of:<projectId>` \| `label-on:<projectId>`                                          | No       |

**Granular vs cascading push**

| Command | Pushes |
|---|---|
| `push EPIC-001` | EPIC + all features + all stories + all tasklists + linked QT/BL (today's default) |
| `push EPIC-001 --no-cascade` | EPIC project only |
| `push FEAT-006` | FEAT + its stories + its tasklist (today's default) |
| `push FEAT-006 --no-cascade` | FEAT issue only |
| `push US-014` (parent FEAT in Linear) | US-014 sub-issue, linked to FEAT |
| `push US-014 --push-parents` (parent FEAT not in Linear) | EPIC + FEAT + US-014. **No sibling stories. No tasklist.** |
| `push TASK-004 --push-parents` (parent FEAT not in Linear) | EPIC + FEAT + this tasklist. **No stories.** |

`--push-parents` is now strictly upward attachment — pushes only what's needed for the target to land in Linear, never the parent's other children. Combine with `--no-cascade` (default for leaves) for the tightest possible push scope.

**Epic mapping strategies**

Every epic is mapped to Linear in one of three shapes, chosen once and stored in `linearMappingStrategy` on the epic's frontmatter:

| Strategy                    | Linear shape                                                                 | When it fits                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `project` (default)         | Epic = Linear Project (one-to-one, the v1 behavior)                          | Large epic with its own roadmap + independent lifecycle                                       |
| `milestone-of:<projectId>`  | Epic becomes a `ProjectMilestone` inside an existing Linear project; descendants carry `projectMilestoneId` | Epic is a phase of a larger initiative; keeps cross-epic visibility on one Linear board       |
| `label-on:<projectId>`      | Epic becomes a team-scoped label; descendants carry `labelIds` (merged with user-added labels, never stomped) | Small epic / mini-initiative that shouldn't own its own project scaffolding                   |

First-time push prompts interactively; CI consumers use `--as` or `linear.defaultEpicStrategy` in config. Re-strategizing an already-mapped epic is a separate flow and not supported here.

**Parent-chain pre-flight**

Granular pushes (`FEAT-`, `US-`, `TASK-`) refuse to run when their parent chain isn't mapped to Linear yet, with a pointer to the command that fixes it. `--push-parents` cascades up instead of bailing. `ADR-` and `SPRINT-` aren't pushable (they're not synced to Linear); the router errors with a pointer to the parent epic.

**Standalone project for QT / BL**

Quick tasks and backlog items push as top-level issues in a user-chosen standalone Linear project (`linear.standaloneProjectId`). First-time QT/BL push prompts you to pick or create one; after that it's silent. Backlog items automatically get a team-scoped `backlog` label; every issue type gets its kind label (`feature`, `story`, `task`, `quick-task`, `backlog` — overridable via `linear.typeLabels`).

**Epic-linked QT / BL**

A QT or BL file with `epicId: "EPIC-XXX"` (or legacy `parentEpic`) in frontmatter is pulled into that epic's Linear container instead of the standalone project. `planr linear push EPIC-XXX` cascades to every linked QT/BL. Unlinked ones stay in the standalone project. `planr quick create --epic` and `planr backlog add --epic` set the link at creation time.

**Mapping:** Epic → Linear project (or milestone / label — see strategies above); feature → top-level issue; story → sub-issue of the feature issue; per-feature merged task list → sub-issue; linked QT/BL → top-level issue in the epic's container. Optional `linear.pushStateIds` maps `pending` / `in-progress` / `done` to Linear workflow **state id** (uuid). Optional `linear.defaultProjectLead` is the Linear user id for project `leadId`. See `planr linear sync` for pulling status **from** Linear into frontmatter.

**Idempotency:** Re-running the command updates the same project and issues when Linear ids are already stored in frontmatter. No duplicate creates.

**Resilience:** A malformed artifact file (unparseable frontmatter, missing title, broken YAML) is skipped with a clear warning and the rest of the push proceeds — one broken file no longer aborts the whole run.

### `planr linear tasklist-sync`

Bidirectionally sync **checkbox** state between local `TASK-*.md` files and the corresponding Linear **TaskList** issues (`linearIssueId` in frontmatter). OpenPlanr reuses a single Linear issue for multiple task files in the same feature by using `## TASK-...` sections; a single file maps to the whole description. A three-way merge uses `linearChecklistReconciled` in each task’s frontmatter as the last known agreement; on divergence you can be prompted, or set `--on-conflict local` or `--on-conflict linear` (e.g. in CI).

```bash
planr linear tasklist-sync
planr linear tasklist-sync --on-conflict linear
```

| Argument / option        | Description | Required |
| ------------------------ | ----------- | -------- |
| `--on-conflict <mode>`   | `prompt` (default), `local`, or `linear` when local and Linear disagree | No |

---

### `planr github push`

Push planning artifacts to GitHub Issues. Requires `gh` CLI to be installed and authenticated (`gh auth login`).

```bash
planr github push EPIC-001              # push a single artifact
planr github push --epic EPIC-001       # push all artifacts under an epic
planr github push --all                 # push all artifacts
```

| Argument/Option   | Description                         | Required                                    |
| ----------------- | ----------------------------------- | ------------------------------------------- |
| `[artifactId]`    | Single artifact ID to push          | One of `[artifactId]`, `--epic`, or `--all` |
| `--epic <epicId>` | Push all artifacts under an epic    | One of `[artifactId]`, `--epic`, or `--all` |
| `--all`           | Push all artifacts across all types | One of `[artifactId]`, `--epic`, or `--all` |

**What it does:**

- Creates a GitHub Issue for each artifact with type-specific formatting (metadata tables, section ordering, collapsible details)
- Labels issues automatically (`planr:epic`, `planr:feature`, `planr:story`, `planr:task`)
- Stores the GitHub issue number in artifact frontmatter (`githubIssue: 123`) for future syncing
- On subsequent pushes, updates the existing issue instead of creating a duplicate
- If a linked issue was deleted on GitHub, gracefully creates a new one

---

### `planr github sync`

Bi-directional status sync between local artifacts and GitHub Issues.

```bash
planr github sync                       # interactive conflict resolution (both directions)
planr github sync --direction pull      # GitHub → local (update local status from issue state)
planr github sync --direction push      # local → GitHub (update issue state from local status)
planr github sync --direction both      # both with interactive conflict resolution (default)
```

| Option              | Description               | Default |
| ------------------- | ------------------------- | ------- |
| `--direction <dir>` | `pull`, `push`, or `both` | `both`  |

**Status mapping:**

- GitHub `open` → local `in-progress` / `draft`
- GitHub `closed` → local `done` / `accepted`
- Local `done` → closes the GitHub issue
- Conflicts (both changed) → interactive prompt to choose which side wins

---

### `planr github status`

Show sync status of all linked artifacts.

```bash
planr github status
```

Displays a table of all artifacts that have a `githubIssue` field, showing local status vs GitHub issue state and whether they are in sync.

---

### `planr report`

Generate a stakeholder report from `.planr/` artifacts and (optionally) recent
GitHub activity. The commands below define the packaged reporting surface.

```bash
planr report weekly                                   # markdown to .planr/reports/
planr report sprint --sprint SPRINT-001               # sprint summary for one sprint
planr report executive --format html                  # HTML wrapper around the markdown
planr report weekly --stdout                          # print to stdout, no file
planr report weekly --no-github                       # skip the gh API calls
planr report weekly --lint                            # run the quality linter on the output
planr report weekly --strict-evidence                 # fail if bullet claims lack URLs or #issue refs
planr report weekly --push slack --dry-run            # show what would be posted to Slack
planr report sprint --push github                     # archive as a planr:report GitHub issue
```

| Option                | Description                                                                              | Default            |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------ |
| `<type>`              | `sprint`, `weekly`, `executive`, `standup`, `retro`, `release`                           | **Required**       |
| `--sprint <id>`       | Sprint id for sprint-scoped reports (e.g. `SPRINT-001`)                                  | Active sprint      |
| `--days <n>`          | GitHub commit/PR lookback window                                                         | `7`                |
| `--no-github`         | Skip the GitHub signal collection                                                        | GitHub enabled     |
| `--format <fmt>`      | `markdown` or `html`. `pdf` exits with a clear "not bundled" message.                    | `markdown`         |
| `--output <dir>`      | Write outputs under this directory (relative to project)                                 | `.planr/reports`   |
| `--stdout`            | Print markdown to stdout instead of writing a file                                       | `false`            |
| `--lint`              | Run the report quality linter on the generated markdown                                  | `false`            |
| `--strict-evidence`   | Fail if substantive bullets under `##` (except **Evidence**) lack URLs or `#NNN` refs; skips full-line `_placeholder_` bullets | `false`            |
| `--push <targets>`    | Comma-separated channels: `github`, `slack`                                              | None               |
| `--dry-run`           | With `--push`, show actions without sending (Slack dry-run works without a webhook)      | `false`            |

**Output files:** `.planr/reports/<YYYY-MM-DD>-<reportType>-report.md` (and `.html` when `--format html`, same basename). Example: `2026-04-19-weekly-report.md`.

**Configuration (`.planr/config.json`):**

```json
{
  "reports": {
    "orgName": "Acme",
    "accentColor": "#0a84ff",
    "logoUrl": "https://example.com/logo.png",
    "customSections": {
      "Compliance": "SOC2 controls verified weekly."
    }
  },
  "templateOverrides": "./reports-overrides",
  "distribution": {
    "slackWebhookUrl": "https://hooks.slack.com/services/...",
    "slackChannel": "#eng-updates"
  }
}
```

`slackChannel` is reserved for future use; Incoming Webhooks target the channel encoded in the webhook URL. All blocks are optional; the command works against a freshly initialized project.

---

### `planr report-linter`

Lint an existing stakeholder markdown file (or stdin) against the same rules `planr report --lint` runs.

```bash
planr report-linter ./drafts/weekly.md --type weekly
cat drafts/sprint.md | planr report-linter --type sprint
```

| Option         | Description                                                                          | Default    |
| -------------- | ------------------------------------------------------------------------------------ | ---------- |
| `[file]`       | Markdown file to lint. If omitted, the command reads from stdin.                     | stdin      |
| `--type <t>`   | Report type for rule selection: `sprint`, `weekly`, `executive`, `standup`, `retro`, `release` | `weekly` |

Findings include rule id, severity, message, and an optional suggestion. Coaching hints are emitted alongside. Exit code is non-zero when any error-severity finding is produced.

Default rules cover vague language, evidence density (URLs / `#issue` refs), and required sections per report type. Extend or override via `reportLinter` in `.planr/config.json`:

```json
{
  "reportLinter": {
    "rules": [
      { "id": "evidence-density", "enabled": true, "minEvidenceLinks": 1 },
      { "id": "weekly-structure", "enabled": true, "requireSections": ["Wins", "Risks", "Ask"] }
    ],
    "vaguePhrases": [
      { "pattern": "\\balmost done\\b", "alternatives": ["Completed 3 of 5 stories"] }
    ]
  }
}
```

---

### `planr context`

Print the report context pack — artifacts, sprint state, GitHub signals, and the flat evidence index — as JSON for piping into other tools.

```bash
planr context --report-type weekly
planr context --report-type sprint --sprint SPRINT-001 --days 14
planr context --report-type weekly | jq '.evidence | length'
```

| Option                 | Description                                                                  | Default    |
| ---------------------- | ---------------------------------------------------------------------------- | ---------- |
| `--report-type <type>` | Logical report type for placeholders (`sprint`, `weekly`, …, `release`)      | `weekly`   |
| `--sprint <id>`        | Sprint id when relevant                                                      | Active     |
| `--days <n>`           | GitHub lookback window                                                       | `7`        |
| `--no-github`          | Omit GitHub signals from the context pack                                    | Enabled    |

The JSON payload is written to stdout; a one-line summary (`context: <n> evidence items`) is logged to stderr.

---

### `planr voice standup`

Convert a transcript file (or stdin) into structured standup markdown using a heuristic Yesterday / Today / Blockers parser. Live microphone capture and bundled speech-to-text are intentionally **not** part of v1 — pair this with any STT or OS dictation tool that produces text.

```bash
planr voice standup --file standups/2026-04-19.txt
planr voice standup --file t.txt --lint
planr voice standup --file t.txt --append-story US-029
planr voice standup --file t.txt --edit          # interactive: open $EDITOR before saving
planr voice standup --file t.txt --reload-file   # interactive: re-read file after editing externally
```

| Option                       | Description                                                                                  | Default       |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ------------- |
| `--file <path>`              | Transcript text file. If omitted, the command reads stdin.                                   | stdin         |
| `--write <path>`             | Write the generated markdown to this path (relative to project, or absolute)                 | None          |
| `--edit`                     | Open the generated markdown in `$EDITOR` before output / save (interactive sessions only)    | `false`       |
| `--reload-file`              | After generating, offer to re-read `--file` from disk (interactive + `--file` only)          | `false`       |
| `--append-story <storyId>`   | Append the standup under `## Standup notes` on this story                                    | None          |
| `--lint`                     | Run the standup through the report linter                                                    | `false`       |

Per-segment audio replay is reserved (`TranscriptSegment.audioOffsetMs` exists in the schema) but not implemented in v1.

---

### `planr export`

Generate a consolidated planning report in markdown, JSON, or HTML format.

```bash
planr export                                    # markdown report in current directory
planr export --format html                      # self-contained HTML report
planr export --format json                      # machine-readable JSON
planr export --format html --scope EPIC-001     # only artifacts under one epic
planr export --output ./reports                 # custom output directory
```

| Option              | Description                                  | Default                 |
| ------------------- | -------------------------------------------- | ----------------------- |
| `--format <format>` | Output format: `markdown`, `json`, or `html` | `markdown`              |
| `--scope <epicId>`  | Only export artifacts under a specific epic  | All artifacts           |
| `--output <path>`   | Output file or directory                     | `.` (current directory) |

**Output formats:**

- **Markdown** — hierarchical report with all artifact details, nested under epics → features → stories → tasks
- **JSON** — structured data with full hierarchy, counts, and metadata for programmatic consumption
- **HTML** — self-contained file with inline CSS, collapsible `<details>` sections, color-coded status badges, and full hierarchy rendering

---


## Workflow

Use the CLI to maintain deterministic repository artifacts; invoke host skills for semantic planning and implementation:

```text
planr init
  └─ planr epic create "Platform renewal"
       └─ planr feature create "OAuth sign-in" --epic EPIC-001
            └─ planr story create "Company sign-in" --feature FEAT-001
                 └─ planr task create "Implement approved flow" --story US-001

planr backlog add "Investigate callback failures" --priority high
planr backlog list
planr backlog update BL-001 --status closed

planr sprint create "Sprint 1" --duration 2w
planr sprint list
planr sprint show SPRINT-001
planr sprint update SPRINT-001 --status closed

planr sync
planr status
planr rules generate
planr github push --all
planr github sync
planr export --format html
```

For semantic decomposition, invoke the installed `planr:plan` skill. After reviewing the plan, invoke `planr:ship` separately.

## ID Convention

| Artifact   | Prefix   | Example      |
| ---------- | -------- | ------------ |
| Epic       | `EPIC`   | EPIC-001     |
| Feature    | `FEAT`   | FEAT-001     |
| User Story | `US`     | US-001       |
| Task List  | `TASK`   | TASK-001     |
| Quick Task | `QT`     | QT-001       |
| Backlog    | `BL`     | BL-001       |
| Sprint     | `SPRINT` | SPRINT-001   |

---

## Config File

`.planr/config.json` stores project settings:

```json
{
  "projectName": "my-project",
  "targets": ["cursor", "claude", "codex"],
  "outputPaths": {
    "agile": ".planr",
    "cursorRules": ".cursor/rules",
    "claudeConfig": ".",
    "codexConfig": "."
  },
  "idPrefix": {
    "epic": "EPIC",
    "feature": "FEAT",
    "story": "US",
    "task": "TASK",
    "quick": "QT",
    "backlog": "BL",
    "sprint": "SPRINT"
  },
  "createdAt": "2026-03-26"
}
```
