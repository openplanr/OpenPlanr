# Cross-runtime setup and operations

## Install

```bash
curl -fsSL https://openplanr.dev/install.sh | sh
# PowerShell
irm https://openplanr.dev/install.ps1 | iex
```

The installer requires Node.js 20 or later and never installs or upgrades Node
silently. `npm install -g openplanr` is equivalent. Then change into a project and
run guided setup:

```bash
cd my-project
planr setup
planr doctor
```

The full pipeline is the default. Use `planr setup --minimal` for dedicated
planning only, or `npx openplanr@latest setup` without a global install.

## Preview, apply, and migrate

```bash
planr setup --dry-run
planr setup
planr doctor
```

Guided setup detects Claude Code, Codex, and Cursor, explains unavailable shell
commands, and prompts for the agents and scope to configure. User scope is the
default. Cursor currently requires project scope. Project writes require a Git
worktree or initialized `.planr` project; setup will never treat `$HOME` as a
project automatically.

Setup prints a compact change summary before mutation; use `--verbose` for
every target. Existing files are copied byte-for-byte to
`~/.planr/backups/` with hashes and a migration manifest. Only managed marker
blocks are replaced; content outside those blocks is preserved.

When Claude Code is selected at user scope, the preview includes the marketplace
and plugin operations. Confirmed setup writes a generated local marketplace
(`openplanr-local`) from the installed package and installs or updates the unified
`planr` plugin from it, so the plugin always matches the CLI version. Setup never
reads the remote `openplanr/marketplace` for versions. The piped installer never
does this on its own. Restart Claude Code when setup says a plugin changed.

### Installation channels

| Channel | Purpose | Status |
| --- | --- | --- |
| `npm i -g openplanr`, then `planr setup` | Primary installation; the plugin is pinned to the CLI | Available |
| `openplanr/marketplace` | Optional direct Claude Code installation | Available; can trail the npm release |
| Anthropic marketplace listing | Vendor discovery and trust | Not yet listed |
| OpenAI Plugins Directory | Vendor discovery for Codex and supported ChatGPT surfaces | Not yet listed |

The release workflow projects each published `openplanr` Claude plugin into
`openplanr/marketplace`; the source stays in this repository. Use one Claude Code
channel per machine: either `planr setup` or
`/plugin marketplace add openplanr/marketplace`, not both.

For CI and provisioning, supply choices explicitly:

```bash
planr setup --runtime auto --scope user --yes
planr setup --runtime codex --scope project --yes
planr setup --runtime all --scope both --yes
planr runtime update claude --scope user --yes
```

Repeated setup is idempotent. To restore the last pre-setup state:

```bash
planr runtime rollback
```

Installing or updating one adapter is additive: it keeps every other managed
adapter and preserves each adapter's existing scope. For example, adding Codex
at user scope does not widen an existing project-only Cursor installation.

Full setup installs the portable planning and pipeline assets for the selected
runtime. `planr doctor` reports managed-file drift and runtime availability.

## Codex skill modes

Codex has three delivery modes, chosen with `--skill-mode`:

- `unified-plugin` (recommended): one `planr` plugin registered through Codex's plugin
  marketplace; skills are invoked as `$planr:<skill>`.
- `direct`: every skill installed separately under `~/.codex/skills/<name>/` and invoked
  by its bare name, for example `$spec`.
- `project-rule`: skills installed into the current project only.

Every installed asset is digest-verified. Switching modes previews the managed
retirements; add `--replace-managed` only after reviewing them.

## Operate cycles

The Operate set is `operate` plus the seven `ceo`, `cto`, `cpo`, `cmo`, `coo`,
`challenger`, and `chair` reviews. Invoke `$planr:operate` (Codex) or `/planr:operate`
(Claude Code) for the guided local review. It uses current-snapshot defaults, asks
through the host's native question surface only for consequential ambiguity, and
reports a missing lens as a visible issue instead of blocking the rest of the report.

The validator is optional editing help for any generated note:

```bash
planr operate validate-note <note.md> --profile advisor|challenger|chair|board-report --contract-version 2.0.0 --json
```

Omit `--contract-version` to auto-detect current v2 and historical v1 notes.

The durable Operate runtime is separate. Discover its exact registered domain
identity with `planr operate domains --json`; neither setup nor the runtime
guesses a domain version. Its issued executors receive a prepared packet and use
only:

```bash
planr operate assignment prepare <assignmentId> --actor <agentId> --runtime codex --json
planr operate assignment validate <packetId> --content-file <resultPath|-> --json
planr operate assignment submit <packetId> --content-file <resultPath|-> --json
```

The packet contains exact issued inputs, schema paths, evidence matrix, rubric,
and an intentionally incomplete role template. Private state remains below
`.planr/operate/` and is not an executor research surface.

Removal deletes only recorded OpenPlanr-owned files whose hashes still match.
Modified or unknown files produce `E_MIGRATION_CONFLICT` before any adapter
bytes are removed. User-scope assets shared by multiple projects are
reference-safe: removing or rolling back one project retains them until no
other managed project installation depends on them.

## Troubleshooting and upgrades

```bash
planr doctor --strict --json
planr setup --dry-run
planr upgrade status
planr upgrade apply
```

- Missing or stale skills: inspect doctor output, then re-run `planr setup`.
  Known owned bytes are repaired transactionally; unknown or modified files are
  preserved and reported as `E_MIGRATION_CONFLICT`.
- First Cycle rejects `--domain-version`: run `planr operate domains --json`
  and copy the exact domain identity. Operate Protocol `2.0.0` is not a domain
  version.
- Assignment prepare/validate/submit fails: use the returned machine `code` and
  `problem`. The CLI intentionally omits host paths and stacks; author only the
  returned `resultPath` and keep `packetId` unchanged.
- CLI/skill parity is incompatible: run `planr upgrade status`, then the
  explicit `planr upgrade apply`, followed by `planr setup` and
  `planr doctor --strict --json` again.

## Offline, remote, and SSH use

After the package and runtime assets are installed, planning artifacts, runtime
routing, status, sync audit, dashboard, design boards, diagrams, and doctor work
without network access. Only tracker sync (GitHub, Linear) and company workspaces
reach the network.

On remote/SSH machines use `--scope user` for reusable skills and `--scope project`
for repository policy. Forward a loopback port explicitly through SSH when a
local artifact-review browser runs elsewhere.

## Windows

The PowerShell installer and the CLI support Node.js 20 or later on Windows. Project paths in
committed locks and generated rules are repository-relative. Machine-specific
absolute paths remain in the user runtime state and backups.

## Security

- No telemetry is added.
- Setup never installs Node or deletes unknown user files.
- `doctor --fix` can remove legacy project files accidentally installed under
  `$HOME`, but only when their recorded ownership hashes still match.
- `doctor --fix` can remove unreachable design/dashboard daemon state after a
  preview and second health check; it never kills or inspects unrelated processes.
- `doctor` detects stale or malformed Claude plugins read-only. `doctor --fix`
  does not install or update them; use the explicit runtime update command it
  prints.
- Credentials are not written to runtime locks or provenance.
- Doctor redacts secrets and only fixes owned files after preview.
- Provenance is append-only. Recovery requires an explicit event rather than
  fabricated history.
