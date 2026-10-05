# openplanr CLI reference

> Every command and flag of the `openplanr` CLI.
> Package: `openplanr` | Binary: `openplanr` (alias: `opr`)

---

## Installation

```bash
npm install -g openplanr

# Verify
openplanr --version
```

---

## Agent-Friendly / Non-Interactive Mode

The CLI auto-detects non-TTY environments (CI, coding agents) and skips interactive prompts by using sensible defaults. You can also opt in explicitly:

```bash
# Explicit flag
openplanr epic create --title "My App" --yes
openplanr task create --story US-001 --title "Implement approved story" --yes

# Auto-detected (no TTY)
echo "" | openplanr epic create --title "My App"
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

### `openplanr company`

The company route connects an explicitly configured workspace to selected local artifacts. Existing encrypted token shares remain separate. Sign in through the browser and choose the organization in the identity provider's consent screen:

```bash
openplanr company login
```

The normal customer flow needs no service URL or output flag. For a remote or
headless session, print the authorization URL instead of launching it:

```bash
# Print the browser URL instead of launching it; open it on this same computer
openplanr company login --no-open --timeout 300
```

Successful sign-in and sign-out show a short confirmation. To switch accounts,
run `openplanr company logout` before signing in again. Recovery and cleanup warnings
remain visible. Structured output with status details and error codes is available
for automation:

```bash
openplanr company login --json
openplanr company logout --json
```

Hosted commands use `https://api.openplanr.dev` by default. `--api-url <origin>` is an advanced override for local development, staging, and self-hosted testing; customers do not need to copy a service URL.

The API advertises its configured public OAuth client through `/.well-known/openplanr-company-auth`. The CLI uses authorization-code/S256 PKCE, a temporary `127.0.0.1` callback, issuer/state validation and discovered same-origin token endpoints. A client secret is never required. This follows [Clerk's CLI pattern](https://clerk.com/blog/adding-clerk-auth-to-your-cli) and [OAuth configuration contract](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth). Public-client registration and live acceptance are deployment setup; the command never registers clients automatically.

Access tokens renew before their returned expiry, with refreshes serialized across CLI processes. Token generations live in the existing OS keychain or encrypted local credential backend; the result discloses the backend. Private metadata pins that backend and supports recovery if token storage succeeds before an interrupted metadata update. An uncertain exchange never automatically reuses a possibly consumed refresh token. Sign out and sign in again when renewed authorization cannot be recovered.

Logout revokes saved refresh and access tokens before removing their local references. A remote failure preserves disabled credentials for retry. `--local-only` intentionally skips remote revocation. Partial or unknown revocation is reported when an interrupted exchange could have issued an unavailable token; review the application authorization in the identity provider. Credential-cleanup failure also remains visible and retryable. Logout does not sign out the browser. `PLANR_COMPANY_TOKEN` and `company connect --token-stdin` are explicit developer fallbacks, with no automatic renewal; an environment override must be unset separately. Never put tokens in command arguments or chat.

Publication selects one repository-relative JSON, Markdown, SVG or HTML file, up to 1 MiB. An authored `openplanr-design-document` selected with `--kind design` packages the complete design: its declared screens, frames, variants, and supported local assets. The entire packaged revision must fit within the same 1 MiB limit. Single HTML/SVG designs remain supported.

```bash
openplanr company preview .planr/designs/checkout/design-document.json \
  --kind design --title "Checkout experience" \
  --project <project-id>
openplanr company publish <preview-id> --json
```

Review the exact selected files, content and publication size before publishing. `--json` includes the complete content for inspection; the default design preview gives a compact file list and screen/frame/variant counts. Source hashes are stored in private local state. Publication rebuilds the package and refuses any changed source or newly referenced file until a fresh preview is reviewed. No directory scan, render cache, or unrelated repository content is published.

The returned binding remembers its source document and accepted remote revision. `company push <binding-id> --preview` rebuilds the design package and lists the selected files; `company push <binding-id>` publishes that exact reviewed update against the bound base. Each later expansion of referenced content needs a fresh preview. See `openplanr company --help` for connection and publication options.

Company publication retries preserve their original IDs and return `already-published` when completing from saved receipts. `synchronization: "not-checked"` means the current remote head has not been read; run `openplanr company status <binding-id>` before describing the workspace as synchronized.

Read-only retrieval uses an existing publication binding:

```bash
openplanr company status <binding-id> --json
openplanr company pull <binding-id> --preview --json
openplanr company pull <binding-id> --json

# Intentionally inspect a historical immutable revision
openplanr company pull <binding-id> --preview --revision <revision-id> --json
openplanr company pull <binding-id> --json
```

The preview reports the selected revision, digest, byte size, content, and whether local or remote content has changed. Pull verifies authorization and exact bytes again, then saves an inert `.txt` copy under `.local/company/remote-content/` with a retrieval receipt. It does not replace the repository file, advance the accepted binding, apply a proposal, or resolve feedback. Divergent or missing local files remain untouched. A changed local file or latest remote head requires a fresh preview. An explicitly selected historical revision stays pinned even if newer revisions appear.

Retrieved content is untrusted input, including HTML and SVG. Inspect it as data. `company proposal` previews typed changes; `company apply` is a separate explicit local action, currently limited to validated canonical diagram JSON. Packaged designs are retrieved as inert review copies and cannot be applied over authored design documents; edit their source files locally and use a reviewed company push instead. A successful application records `applied-locally` with remote acknowledgement pending. Preserve local backups and recovery journals, and retry the same application after interruption.


---

### Deterministic planning artifacts

Initialize project-local storage, then create planning artifacts from explicit flags or a JSON object:

```bash
openplanr init --name "my-project"
openplanr epic create "Platform renewal"
openplanr feature create "OAuth sign-in" --epic EPIC-001
openplanr story create "Sign in with the company identity provider" --feature FEAT-001
openplanr task create "Implement approved sign-in flow" --story US-001
openplanr quick create "Fix the callback error"
openplanr backlog add "Add callback rate limits" --priority high --tag security
openplanr sprint create "Sprint 1" --duration 2w
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
| Sprint | A title; duration defaults to `2w`; JSON may add `status` (`planned`/`active`), `startDate`, `endDate`, `releaseCut`, `capacityDays`, `refinedAt` and `batches` |

Use deterministic JSON when an agent or integration supplies complete fields:

```bash
openplanr epic create --data epic.json --json
openplanr feature create --data feature.json --json
openplanr task create --data - --json < task.json
```

`openplanr update <ids...>` supports bulk status changes. `--all-done` and `--all-pending` also update canonical task checkboxes for task and quick-task artifacts. Use each command's `--help` output for its exact options.

### `openplanr sprint` refinement

The `planr:sprint` skill judges every open item and selects a sprint; these commands store what it decides. Sprint statuses are `planned`, `active` and `closed`.

```bash
openplanr sprint create --data sprint.json --json            # name, releaseCut, capacityDays, optional batches
openplanr sprint refinement SPRINT-004 --data refinement.json # validate, store, fill the sprint body
openplanr sprint diff SPRINT-003 SPRINT-004                   # what moved between two runs
openplanr sprint apply SPRINT-004 --dry-run                   # preview the status write-back
openplanr sprint apply SPRINT-004 --yes --commit              # write it as one commit
openplanr sprint close SPRINT-004                             # record leftovers for the next run
```

| Command | Behaviour |
| --- | --- |
| `refinement <id> --data <path\|->` | Validates the refinement document (`schemaVersion: 1`, `sprintId`, `refinedAt`, `inputs`, `items[]`, `buckets{inProgress, planNext, blocked, closeOrDemote}`, `batches[]`, `refuted[]`), writes `.planr/sprints/<id>/refinement.json` and `refinement.md`, and rewrites the sprint's `## Tasks` as one checkbox per in-progress item grouped by batch (`- [ ] **BL-012** title · effort · [view](../backlog/…)`), keeping boxes that were already checked. Sets `taskIds`, `refinedAt`, `capacityDays` and `releaseCut` on the sprint. Refuses closed sprints. |
| `diff <from> <to>` | Compares two stored documents: bucket moves with score changes, added and removed items. |
| `apply <id>` | Writes each item's `targetStatus` and `targetPriority` (backlog only) and the `blockedBy` note of blocked items to the artifacts. Statuses must belong to the type's vocabulary unless `--force`. Needs `--yes` (or `--dry-run`); with `--commit` the touched files are committed as `chore(planr): refine backlog for <id>`. |
| `close <id>` | Sets `status: closed` and `closedAt`, and records `leftovers[]` (unchecked or unfinished `taskIds`) in `refinement.json` for the next run. |

Every command accepts `--json`. Failures use bounded codes such as `E_SPRINT_NOT_FOUND`, `E_SPRINT_REFINEMENT_INVALID` (with `$`-rooted diagnostics), `E_SPRINT_REFINEMENT_MISSING`, `E_SPRINT_APPLY_CONFIRMATION_REQUIRED`, `E_SPRINT_APPLY_STATUS_INVALID`, `E_SPRINT_CLOSED` and `E_SPRINT_ALREADY_CLOSED`. `openplanr status` lists the active sprint first with its release cut and checkbox progress, and `openplanr status --json` exposes it as `sprint`.


### `openplanr spec`

Spec-driven planning mode — third posture alongside agile + QT, designed for **planning *for* AI coding agents**. Each spec is a self-contained directory at `.planr/specs/SPEC-NNN-{slug}/` containing the spec doc, decomposed User Stories, decomposed Tasks, and any UI design assets. The artifact schema mirrors the [@openplanr/pipeline](https://github.com/openplanr/OpenPlanr/tree/main/packages/pipeline) canonical protocol schemas under `schemas/v1.0.0/` — file Create/Modify/Preserve lists, Type=UI|Tech, agent assignment, DoD with build/test commands. The two products use one artifact contract; no conversion adapter ever.

The generated artifact contract and command examples in this section are the
packaged source of truth for spec-driven mode.

#### `openplanr spec init`

Activate spec-driven mode in the current project. Creates `.planr/specs/`. Adds `spec: SPEC` to `idPrefix` if missing. Idempotent.

```bash
openplanr spec init
```

---

#### `openplanr spec create`

Create a new spec — a self-contained directory with `stories/`, `tasks/`, `design/` subfolders.

```bash
openplanr spec create "Auth flow"
openplanr spec create --title "Auth flow" --slug auth --priority P0 --milestone v1.0
openplanr spec create "User Onboarding" --po @AsemDevs
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

#### `openplanr spec shape`

Interactive 4-question authoring of a spec's body. Walks the PO through Context, Functional Requirements, Business Rules, and Acceptance Criteria. Optionally captures Out-of-Scope items and Decomposition Notes. Updates `status: pending → shaping`.

```bash
openplanr spec shape SPEC-001
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

#### `openplanr spec sync`

Validate spec integrity and auto-fix safe inconsistencies. Use after manual edits, interrupted work, or when in doubt.

```bash
openplanr spec sync                       # scan all specs
openplanr spec sync SPEC-001              # scope to one spec
openplanr spec sync --dry-run             # report findings without writing fixes
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

#### `openplanr spec list`

List all specs with title, status, and decomposition counts.

```bash
openplanr spec list
```

---

#### `openplanr spec show`

Print a spec's metadata, body summary, and the full US/Task decomposition tree.

```bash
openplanr spec show SPEC-001
```

---

#### `openplanr spec status`

Decomposition state. Without args: aggregate report across all specs. With a spec ID: focused view.

```bash
openplanr spec status                # aggregate
openplanr spec status SPEC-001       # focused
```

---

#### `openplanr spec destroy`

Remove a spec entirely. Because each spec is a self-contained directory, this is a single `rm -rf`. Prompts for confirmation (use `--yes` to skip).

```bash
openplanr spec destroy SPEC-001
openplanr spec destroy SPEC-001 --yes
```

---

#### `openplanr spec attach-design`

Copy PNG mockup files into the spec's `design/` subdirectory and update
`ui_files` frontmatter on the SPEC. The `planr:plan` host skill reads these
inputs while it builds the reviewed implementation plan.

```bash
openplanr spec attach-design SPEC-001 --files login.png signup.png
```

---

#### `openplanr spec promote`

Validate that a spec is ready for handoff to `@openplanr/pipeline` (has stories, tasks, non-trivial body) and print the next-step pipeline command. Updates SPEC frontmatter `status: ready-for-pipeline`.

```bash
openplanr spec promote SPEC-001
```

After promotion, run from any configured runtime:

```text
/planr:plan       # Claude Code
$planr:plan       # Codex
```

---

### `openplanr template list`

List all available task templates (built-in and custom).

```bash
openplanr template list
```

Shows template name, description, task count, and whether it's built-in or custom.

---

### `openplanr template show`

Preview a template's contents and variables.

```bash
openplanr template show rest-endpoint
```

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `<name>` | Template name | **Yes**  |

---

### `openplanr template use`

Generate a task list from a template with variable substitution.

```bash
openplanr template use rest-endpoint --title "User Profile API"
openplanr template use react-component --title "Dashboard Widget"
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

### `openplanr template save`

Save an existing task list as a reusable custom template.

```bash
openplanr template save TASK-001 --name my-pattern
```

| Argument/Option | Description                      | Required |
| --------------- | -------------------------------- | -------- |
| `<taskId>`      | Task list ID to save as template | **Yes**  |
| `--name <name>` | Template name                    | **Yes**  |

**Output:** `.planr/templates/<name>.json`

---

### `openplanr template delete`

Remove a custom template.

```bash
openplanr template delete my-pattern
```

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `<name>` | Template name | **Yes**  |

Prompts for confirmation before deleting. Only custom templates can be deleted.

---

### `openplanr checklist show`

Display the agile development checklist.

```bash
openplanr checklist show
```

Shows the full 5-phase checklist:

1. Requirements Analysis
2. Technical Design
3. Architecture Decision Records
4. Solution Planning
5. Solution Review

---

### `openplanr checklist toggle`

Interactively toggle checklist items. Presents a multi-select prompt where you can check/uncheck items, then writes changes back to the file with a progress summary.

```bash
openplanr checklist toggle
```

---

### `openplanr checklist reset`

Reset the checklist back to its initial state.

```bash
openplanr checklist reset
```

---

### `openplanr init`

Initialize deterministic project storage in `.planr/`. Runtime installation belongs to `openplanr setup`.

```bash
openplanr init
openplanr init --name my-project
openplanr init --force
```

| Option | Description |
| --- | --- |
| `--name <name>` | Project name; defaults to the current directory name |
| `--force` | Replace an existing project configuration intentionally |

---

### `openplanr setup`, `openplanr runtime`, and `openplanr doctor`

```bash
openplanr setup
openplanr setup --runtime auto --scope user --yes
openplanr setup --dry-run
openplanr setup --minimal
openplanr runtime detect
openplanr runtime install codex --scope user
openplanr runtime update claude --scope user
openplanr runtime rollback
openplanr doctor --strict
```

Interactive setup guides coding-agent and scope selection. It installs the OpenPlanr skills bundled with the CLI. User scope is
the default; project scope requires a Git worktree or initialized OpenPlanr
project. Setup previews mutations, backs up existing bytes, preserves content
outside managed markers, writes `.planr/runtime-lock.json` only for project
installations, and is idempotent. `--minimal` skips agent integration and writes no setup files; the installed CLI already provides planning utilities.

The preview shows the OpenPlanr version, affected agents, actual destinations, plugin operations, and files to add, update and remove. The Codex choices are OpenPlanr plugin, Individual skills and Project skills; existing `--skill-mode` values remain compatible. The current OpenPlanr Cursor integration requires project scope. Recovery guidance points to a valid project setup path.

For user-scoped Claude Code setup, the preview also lists the Claude plugin
operations. After confirmation, setup registers the generated local marketplace
(`openplanr-local`) that ships inside the installed `openplanr` package and
installs or updates `planr@openplanr-local` from it, so the plugin always matches
this CLI. Setup never reads `openplanr/marketplace` for versions.
`openplanr doctor` checks the installed plugin's version and stable manifest identity
without mutating Claude Code, and warns about older `openplanr@…` and
`planr-pipeline@…` plugins. `doctor --fix` preserves saved scopes and discovery
mode while previewing owned-file, managed native plugin and stale-daemon repairs.
It asks once before applying the displayed changes using the current CLI's bundled
plugin. File repairs are grouped by agent; `--verbose` includes paths, and `--json`
includes the exact repair preview and restart requirement. Restart the affected
host to reload discovery after a native plugin change. Unrelated plugins and
modified owned files are not silently removed.
`runtime install` and `runtime update` print one line per coding agent with what
changed and which agent to restart; `--verbose` adds the changed files and
`--json` prints the full result. Restart Claude Code when setup or `runtime
update` reports a plugin change.
Use one Claude Code channel per machine; see
[installation channels](CROSS_RUNTIME_SETUP.md#installation-channels).

Use the corresponding `planr:*` skills through the installed runtime adapter.
Semantic workflows are not duplicated as utility CLI commands.

### `openplanr operate`

The public Operate namespace supports two distinct products. The installed
`$planr-operate` skill runs a guidance-first local seven-lens review with no
named-owner, receipt, evidence-ledger, or blocking-validation prerequisite.
Its optional note checker reports bounded structural diagnostics:

```bash
openplanr operate validate-note <note.md> --profile advisor|challenger|chair|board-report --contract-version 2.0.0 --json
```

Diagnostics are editing help. Missing or malformed lens output remains a
visible issue with its impact and next action; it does not discard other useful
findings or force a correction loop. `--contract-version auto` is the default;
it detects declared or structurally identifiable v1 and v2 Markdown notes.

The other `openplanr operate` commands expose the durable Protocol 2.0 stateful
runtime. For that interface, first discover the installed domains. The command
returns canonical `domainId`/`domainVersion` pairs and registered roles without
opening project runtime storage:

```bash
openplanr operate domains --json
```

Pass one exact returned identity to Cycle start. Do not substitute the protocol
version for the domain version.

```bash
openplanr operate start \
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
openplanr operate assignment prepare <assignmentId> --actor <agentId> --runtime codex --json
openplanr operate assignment validate <packetId> --content-file <resultPath|-> --json
openplanr operate assignment submit <packetId> --content-file <resultPath|-> --json
```

`prepare` claims idempotently and returns the exact packet paths. `validate`
reports bounded schema and semantic failures with JSON pointers. `submit`
derives claimant and custody from the packet and accepts exact file or stdin
bytes. The diagnostic `claim`, `artifact`, and low-level `submit` commands are
not part of the generated executor workflow.

Useful read-only and recovery surfaces:

| Command | Purpose |
| --- | --- |
| `openplanr operate cycle <cycleId> --actor <humanActorId> --json` | Read the exact owner-bound Cycle experience |
| `openplanr operate dashboard <cycleId> --actor <humanActorId>` | Open the loopback dashboard |
| `openplanr operate recovery storage-status --json` | Inspect neutral storage and migration status |
| `openplanr operate assignment recover --json` | Clear only runtime-confirmed abandoned packets |

Failures from packet commands are bounded in both human and `--json` output;
machine output contains `ok`, `code`, and `problem` without stack traces or host
paths. For setup or command parity failures, run `openplanr doctor --strict --json`.
Use `openplanr upgrade status`, then `openplanr upgrade apply` when doctor reports an
incompatible installed CLI. `upgrade apply` prints the new version, up to five
highlights per release (`--notes full` prints every entry), and the command that
updates each installed coding agent. The published compatible set is read from the npm
registry's `latest` CLI document (its version and the exact `@openplanr/pipeline` it
bundles); `OPENPLANR_ECOSYSTEM_SOURCE` points the check at another URL or file.

### `openplanr artifact`

Open, share, import, and export native diagrams, designs, and HTML reviews:

```bash
openplanr artifact <file>
openplanr artifact open <file> [--title <title>] [--root <asset-root>] [--theme auto|light|dark] [--presentation auto|document|canvas] [--port <port>] [--no-open] [--json]
openplanr artifact share <file> [--title <title>] [--root <asset-root>] [--presentation auto|document|canvas] [--snapshot] [--short] [--ttl 1d|7d|30d] [--secret-output <private-file>] [--no-open] [--json] [--yes]
openplanr artifact publish <diagram-manifest|diagram-bundle|design-document> [--yes] [--json]
openplanr artifact sync <diagram-manifest|diagram-bundle|design-document> [--json]
openplanr artifact import --secret-input <private-file|-> [--output <path>] [--allow-stale] [--json] [--yes]
openplanr artifact export <session-id> [--format json|markdown] [--output <path>]
```

Diagram manifests and authoring bundles share directly to one permanent native
review per stable `/diagram/<id>` link, with a separate reviewer access token.
The local studio's **Share diagram** dialog copies the link and token separately.
Owner credentials stay privately outside the repository. Publish revisions
explicitly; `sync` imports revision-bound feedback without changing the diagram.
Native diagram sharing does not accept `--snapshot`, `--short`, or `--ttl`;
export HTML first to choose the generic snapshot transport.

When `--root` is omitted, the artifact file's directory is the asset root. This
makes `openplanr artifact share /absolute/path/to/artifact.html` work without
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

### `openplanr rules generate`

Generate AI agent rule files for Cursor, Claude Code, and/or Codex. Two flags: **`--target`** (which runtime) and **`--scope`** (which workflow — agile or pipeline).

```bash
openplanr rules generate                                       # all targets, agile scope (default)
openplanr rules generate --target cursor                       # cursor only, agile scope
openplanr rules generate --target cursor --scope pipeline      # cursor pipeline rules (Cursor adapter for @openplanr/pipeline)
openplanr rules generate --target codex --scope pipeline       # AGENTS.md with pipeline orchestration section
openplanr rules generate --target all --scope all              # everything for everyone
openplanr rules generate --dry-run                             # preview without writing
```

| Option              | Description                                       | Default |
| ------------------- | ------------------------------------------------- | ------- |
| `--target <target>` | `cursor`, `claude`, `codex`, or `all`             | `all`   |
| `--scope <scope>`   | `agile`, `pipeline`, or `all`                     | `agile` |
| `--dry-run`         | Show what would be generated                      | `false` |

**`--scope agile` (default — preserves existing behaviour):** generates the agile-mode rules for epic → feature → story → task workflows.

**`--scope pipeline`:** generates rule files that drive the [@openplanr/pipeline](https://github.com/openplanr/OpenPlanr/tree/main/packages/pipeline) two-phase spec-driven workflow on the chosen runtime. Cross-runtime parity with the Claude Code plugin.

**Generated files by `target × scope`:**

| Target × Scope          | Output                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `cursor` × `agile`      | `.cursor/rules/{agile-checklist,create-epic,create-features,create-user-story,create-task-list,implement-task-list}.mdc` (6 files) |
| `cursor` × `pipeline`   | `.cursor/rules/openplanr.mdc` + `openplanr-roles/{9 role files}.md` + deprecation aliases |
| `claude` × `agile`      | `CLAUDE.md` (agile context-gathering protocol)                                                                |
| `claude` × `pipeline`   | `CLAUDE.md` with the pipeline block and the `## OpenPlanr capabilities` skill map                          |
| `codex` × `agile`       | `AGENTS.md` (agile context)                                                                                   |
| `codex` × `pipeline`    | `AGENTS.md` project policy with the `## OpenPlanr capabilities` skill map; `openplanr setup` installs the skills |
| `* × all`               | Both scopes side-by-side                                                                                      |

**Cross-runtime support:** v1.0 artifacts plus v1.1 capability contracts run on
Claude Code, Cursor, and Codex. Codex uses skills and native subagents when exposed;
Cursor uses Composer handoff with sequential fallback.

---

### `openplanr sync`

Validate and repair cross-references across all artifacts.

```bash
openplanr sync                          # fix broken cross-references
openplanr sync --dry-run                # preview changes without writing
```

With the pipeline scope, `CLAUDE.md` and `AGENTS.md` also receive a generated
`## OpenPlanr capabilities` section listing every skill (with its triggers) and,
for Claude Code, the delegated agents, read from the shipped capability map.
Start with `/planr:openplanr` (`$planr:openplanr` in Codex) when the right
skill is unclear.

| Option      | Description                                  | Default |
| ----------- | -------------------------------------------- | ------- |
| `--dry-run` | Show what would change without writing files | `false` |

**What it checks:**

- **Stale links:** Parent links to a child file that doesn't exist on disk
- **Missing links:** Child references a parent, but parent doesn't list the child
- **Duplicates:** Same child linked more than once in a parent

Handles both story-level and feature-level task relationships.

---

### `openplanr status`

Show project planning progress with tree view, completion metrics, and color-coded progress.

```bash
openplanr status
openplanr status --all
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

### `openplanr graph`

Emit the OpenPlanr artifact graph. `--json` is the stable machine-readable
contract consumed by `@openplanr/pipeline` dashboard and ecosystem conformance.

```bash
openplanr graph --json
```

| Option   | Description                         | Default |
| -------- | ----------------------------------- | ------- |
| `--json` | Output `{ nodes, edges }` as JSON   | `false` |

The JSON output follows `@openplanr/pipeline/schemas/v1.0.0/graph.schema.json`.

---

### `openplanr config show`

Display the current deterministic project configuration.

```bash
openplanr config show
```

---

### `openplanr config set-agent`

Set the default coding agent for task implementation guidance.

```bash
openplanr config set-agent                   # interactive prompt
openplanr config set-agent cursor            # set directly
```

| Argument  | Description                    | Required     |
| --------- | ------------------------------ | ------------ |
| `[agent]` | `claude`, `cursor`, or `codex` | No (prompts) |

---

### `openplanr linear init`

Authenticate to [Linear](https://linear.app) with a personal access token, then allow one, several, or all accessible teams. When several teams are enabled, choose the default used by commands that omit `--team`. OpenPlanr saves the allowed `linear.teams` plus the backward-compatible default `linear.teamId` and `linear.teamKey` in `.planr/config.json`. The token is stored via the credentials service (or the `PLANR_LINEAR_TOKEN` environment variable) and is never written into `config.json`.

```bash
openplanr linear init
```

`openplanr linear push <artifact> --team <id-or-key>` targets any team selected during init. A push always targets one team; OpenPlanr does not duplicate an artifact across every team because each artifact has one authoritative Linear linkage.

### `openplanr linear sync`

**Two steps in one command:** (1) **bidirectional workflow status sync** for every Feature, Story, Quick task, and Backlog item with a `linearIssueId` — three-way merge between local frontmatter, Linear's workflow state, and a stored baseline; (2) run **task checklist** sync (`TASK-*.md` ↔ Linear) for all task files that share a `linearIssueId` (see `openplanr linear tasklist-sync`). Use `--verbose` to log per-artifact work.

```bash
openplanr linear sync
openplanr linear sync --dry-run
openplanr linear sync --on-conflict linear
openplanr --verbose linear sync
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

`openplanr quick update --status <v>` and `openplanr backlog update --status <v>` automatically clear `linearStatusReconciled` so the next sync sees a local change and pushes it up.

**Status sync coverage**

| Artifact | Local values | Bidirectional sync |
|---|---|---|
| feature / story | `planning` · `in-progress` · `done` | ✅ |
| quick (`QT-`) | `pending` · `in-progress` · `done` | ✅ |
| backlog (`BL-`) | `open` · `closed` · `promoted` | ✅ (never auto-overwrites `promoted`) |
| task (`TASK-`) | `pending` · `in-progress` · `done` (per-file) | ✅ push (aggregated to merged TaskList issue); pull deferred — see below |

**TASK aggregation on push.** A single Linear TaskList issue aggregates every `TASK-NNN.md` file under one feature (one issue, multiple checkbox lists merged). `openplanr linear push` resolves a single workflow stateId for that issue using the rule:

| Local task-file statuses | Linear TaskList state |
|---|---|
| All `done` | Done (`completed`) |
| Any `in-progress` | In Progress (`started`) |
| Mix of `done` + `pending` (no in-progress) | In Progress (`started`) — work has begun |
| All `pending` | Todo (`unstarted`) |

The `--all-done` flag on `openplanr task update` (see above) is the recommended path: flipping every checkbox in a task file to `[x]` and setting `status: done` makes the next `openplanr linear push FEAT-XXX` move the merged TaskList issue to Done.

**Pull-side TASK propagation** (Linear → all task files under feature) is tracked separately — partial-disagreement guards aren't trivial. `openplanr linear tasklist-sync` continues to handle per-checkbox sync as today.

**Baseline frontmatter fields** (written by sync, optional; missing = no prior sync):

- `linearStatusReconciled: "done"` — the last agreed-upon status.
- `linearStatusSyncedAt: "2026-04-23T12:34:56Z"` — ISO timestamp of the last sync.

**Audit log.** Non-interactive conflict auto-resolutions are recorded to `.planr/reports/linear-sync-conflicts-<date>.md` (same file as checkbox conflicts; each row tagged with `kind: status` or `kind: checkbox`).

**Estimate sync**

`openplanr linear push` also writes an artifact's reviewed `estimatedPoints` or `storyPoints` to Linear's native Issue estimation field, per the team's configured scale:

| Team scale | Behavior |
|---|---|
| `fibonacci` | local values snap to nearest of `{0, 1, 2, 3, 5, 8, 13, 21}`; e.g. `4 → 5`, `7 → 8` |
| `linear` | snap to `{0, 1, 2, 3, 4, 5}` |
| `exponential` | snap to `{0, 1, 2, 4, 8, 16}` |
| `tShirt` | skipped (no reliable numeric → XS/S/M/L/XL mapping); one-per-run warning |
| `notUsed` | skipped silently |

Applies to FEAT / US / QT / BL pushes. TASK is intentionally out of scope — one Linear TaskList issue aggregates multiple local `TASK-*.md` files (same rationale as the TASK status deferral), so estimate aggregation rules are tracked as a follow-up.

The team scale is auto-detected per push run and cached. Set a reviewed `estimatedPoints: <n>` in the artifact frontmatter, then `openplanr linear push` sends it.

**Status-name aliases (push side):** values like `completed`, `cancelled`, `canceled`, and `todo` on a QT/feature/story are transparently treated as `done`/`pending` so hand-edited frontmatter using Linear's native vocabulary still works.

**Zero-config auto-derive:** on every push run, `openplanr linear push` fetches the team's workflow states once and auto-derives a status→stateId map from Linear's canonical state **types** (`backlog` / `unstarted` / `started` / `completed` / `canceled`). You don't need to configure anything for basic status sync to work — the first `pending`/`open` state of each canonical type becomes the default. Configure `linear.pushStateIds` only when you want non-default routing (e.g., push `done` to "Released" instead of the first `completed` state).

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

### `openplanr linear status`

**Local only** — no Linear API. Prints a text table: OpenPlanr id, Linear identifier, URL, last-known `status` (or em dash for epics), and a note for malformed or stale `linearIssueId` values (e.g. a workflow state uuid mistaken for an issue id).

```bash
openplanr linear status
openplanr linear status --scope EPIC-001
```

### `openplanr linear push`

Create or update Linear entities for any planning artifact, at the smallest scope the id implies. Accepts any supported prefix — `EPIC-`, `FEAT-`, `US-`, `TASK-`, `QT-`, `BL-` — and writes `linearProject*` / `linearIssue*` / `linearMilestoneId` / `linearLabelId` / `linearProjectMilestoneId` / `linearLabelIds` / `linearTaskChecklistSyncedAt` back to artifact frontmatter. Requires `openplanr linear init` and a team id in config.

```bash
openplanr linear push EPIC-001                              # full subtree: project + features + stories + tasklists + linked QT/BL
openplanr linear push FEAT-015                              # just one feature + its stories + its tasklist
openplanr linear push US-054                                # just one story
openplanr linear push TASK-015                              # just one tasklist sub-issue
openplanr linear push QT-007                                # standalone quick task (or epic-linked if QT has epicId)
openplanr linear push BL-001                                # backlog item (auto `backlog` label)
openplanr linear push EPIC-001 --dry-run                    # local preview only; no Linear API calls
openplanr linear push EPIC-001 --update-only                # only update existing linked entities
openplanr linear push FEAT-015 --push-parents               # if the parent epic isn't pushed yet, push it first (upward attachment only)
openplanr linear push FEAT-015 --no-cascade                 # push only this feature — skip its stories and tasklist
openplanr linear push EPIC-001 --no-cascade                 # push only the epic project — no features
openplanr linear push TASK-004 --push-parents               # push parent feature (no sibling stories) + this tasklist
openplanr linear push EPIC-001 --as milestone-of:<projectId># first-time mapping strategy override
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

A QT or BL file with `epicId: "EPIC-XXX"` (or legacy `parentEpic`) in frontmatter is pulled into that epic's Linear container instead of the standalone project. `openplanr linear push EPIC-XXX` cascades to every linked QT/BL. Unlinked ones stay in the standalone project. `openplanr quick create --epic` and `openplanr backlog add --epic` set the link at creation time.

**Mapping:** Epic → Linear project (or milestone / label — see strategies above); feature → top-level issue; story → sub-issue of the feature issue; per-feature merged task list → sub-issue; linked QT/BL → top-level issue in the epic's container. Optional `linear.pushStateIds` maps `pending` / `in-progress` / `done` to Linear workflow **state id** (uuid). Optional `linear.defaultProjectLead` is the Linear user id for project `leadId`. See `openplanr linear sync` for pulling status **from** Linear into frontmatter.

**Idempotency:** Re-running the command updates the same project and issues when Linear ids are already stored in frontmatter. No duplicate creates.

**Resilience:** A malformed artifact file (unparseable frontmatter, missing title, broken YAML) is skipped with a clear warning and the rest of the push proceeds — one broken file no longer aborts the whole run.

### `openplanr linear tasklist-sync`

Bidirectionally sync **checkbox** state between local `TASK-*.md` files and the corresponding Linear **TaskList** issues (`linearIssueId` in frontmatter). OpenPlanr reuses a single Linear issue for multiple task files in the same feature by using `## TASK-...` sections; a single file maps to the whole description. A three-way merge uses `linearChecklistReconciled` in each task’s frontmatter as the last known agreement; on divergence you can be prompted, or set `--on-conflict local` or `--on-conflict linear` (e.g. in CI).

```bash
openplanr linear tasklist-sync
openplanr linear tasklist-sync --on-conflict linear
```

| Argument / option        | Description | Required |
| ------------------------ | ----------- | -------- |
| `--on-conflict <mode>`   | `prompt` (default), `local`, or `linear` when local and Linear disagree | No |

---

### `openplanr github push`

Push planning artifacts to GitHub Issues. Requires `gh` CLI to be installed and authenticated (`gh auth login`).

```bash
openplanr github push EPIC-001              # push a single artifact
openplanr github push --epic EPIC-001       # push all artifacts under an epic
openplanr github push --all                 # push all artifacts
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

### `openplanr github sync`

Bi-directional status sync between local artifacts and GitHub Issues.

```bash
openplanr github sync                       # interactive conflict resolution (both directions)
openplanr github sync --direction pull      # GitHub → local (update local status from issue state)
openplanr github sync --direction push      # local → GitHub (update issue state from local status)
openplanr github sync --direction both      # both with interactive conflict resolution (default)
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

### `openplanr github status`

Show sync status of all linked artifacts.

```bash
openplanr github status
```

Displays a table of all artifacts that have a `githubIssue` field, showing local status vs GitHub issue state and whether they are in sync.

---

### `openplanr report`

Generate a stakeholder report from `.planr/` artifacts and (optionally) recent
GitHub activity. The commands below define the packaged reporting surface.

```bash
openplanr report weekly                                   # markdown to .planr/reports/
openplanr report sprint --sprint SPRINT-001               # sprint summary for one sprint
openplanr report executive --format html                  # HTML wrapper around the markdown
openplanr report weekly --stdout                          # print to stdout, no file
openplanr report weekly --no-github                       # skip the gh API calls
openplanr report weekly --lint                            # run the quality linter on the output
openplanr report weekly --strict-evidence                 # fail if bullet claims lack URLs or #issue refs
openplanr report weekly --push slack --dry-run            # show what would be posted to Slack
openplanr report sprint --push github                     # archive as a planr:report GitHub issue
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

### `openplanr report-linter`

Lint an existing stakeholder markdown file (or stdin) against the same rules `openplanr report --lint` runs.

```bash
openplanr report-linter ./drafts/weekly.md --type weekly
cat drafts/sprint.md | openplanr report-linter --type sprint
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

Each `pattern` is a case-insensitive regular expression. A pattern that does not compile, or that can match empty text (such as `(soon)?` or a lone `\b`), fails config loading with `E_CONFIG_INVALID` naming the field and the pattern.

---

### `openplanr context`

Print the report context pack — artifacts, sprint state, GitHub signals, and the flat evidence index — as JSON for piping into other tools.

```bash
openplanr context --report-type weekly
openplanr context --report-type sprint --sprint SPRINT-001 --days 14
openplanr context --report-type weekly | jq '.evidence | length'
```

| Option                 | Description                                                                  | Default    |
| ---------------------- | ---------------------------------------------------------------------------- | ---------- |
| `--report-type <type>` | Logical report type for placeholders (`sprint`, `weekly`, …, `release`)      | `weekly`   |
| `--sprint <id>`        | Sprint id when relevant                                                      | Active     |
| `--days <n>`           | GitHub lookback window                                                       | `7`        |
| `--no-github`          | Omit GitHub signals from the context pack                                    | Enabled    |

The JSON payload is written to stdout; a one-line summary (`context: <n> evidence items`) is logged to stderr.

---

### `openplanr voice standup`

Convert a transcript file (or stdin) into structured standup markdown using a heuristic Yesterday / Today / Blockers parser. Live microphone capture and bundled speech-to-text are intentionally **not** part of v1 — pair this with any STT or OS dictation tool that produces text.

```bash
openplanr voice standup --file standups/2026-04-19.txt
openplanr voice standup --file t.txt --lint
openplanr voice standup --file t.txt --append-story US-029
openplanr voice standup --file t.txt --edit          # interactive: open $EDITOR before saving
openplanr voice standup --file t.txt --reload-file   # interactive: re-read file after editing externally
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

### `openplanr export`

Generate a consolidated planning report in markdown, JSON, or HTML format.

```bash
openplanr export                                    # markdown report in current directory
openplanr export --format html                      # self-contained HTML report
openplanr export --format json                      # machine-readable JSON
openplanr export --format html --scope EPIC-001     # only artifacts under one epic
openplanr export --output ./reports                 # custom output directory
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
openplanr init
  └─ openplanr epic create "Platform renewal"
       └─ openplanr feature create "OAuth sign-in" --epic EPIC-001
            └─ openplanr story create "Company sign-in" --feature FEAT-001
                 └─ openplanr task create "Implement approved flow" --story US-001

openplanr backlog add "Investigate callback failures" --priority high
openplanr backlog list
openplanr backlog update BL-001 --status closed

openplanr sprint create "Sprint 1" --duration 2w
openplanr sprint list
openplanr sprint show SPRINT-001
openplanr sprint refinement SPRINT-001 --data refinement.json
openplanr sprint apply SPRINT-001 --yes --commit
openplanr sprint close SPRINT-001

openplanr sync
openplanr status
openplanr rules generate
openplanr github push --all
openplanr github sync
openplanr export --format html
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
