# Cross-runtime setup and operations

## Install

```bash
curl -fsSL https://openplanr.dev/install.sh | sh
# PowerShell
irm https://openplanr.dev/install.ps1 | iex
```

The installer requires a supported Node.js version (see [package metadata](../package.json)) and never installs or upgrades Node
silently. `npm install -g openplanr` is equivalent. Then change into a project and
run guided setup:

```bash
cd my-project
openplanr setup
openplanr doctor
```

Setup configures the OpenPlanr skills bundled with the installed CLI. Your coding
agent runs planning, design, review and implementation workflows. Use
`npx openplanr@latest setup` without a global install. The compatibility option
`--minimal` skips agent integration and changes no setup files; the installed CLI
already provides planning utilities.

## Preview, apply, and migrate

```bash
openplanr setup --dry-run
openplanr setup
openplanr doctor
```

Guided setup detects Claude Code, Codex, and Cursor, explains unavailable shell
commands, and prompts for the agents and scope to configure. User scope is the
default. OpenPlanr's current Cursor integration uses project rules and requires project
scope; this is an integration limitation, not a limitation of Cursor's native
skill support. Project writes require a Git
worktree or initialized `.planr` project; setup will never treat `$HOME` as a
project automatically.

Setup previews the OpenPlanr version, selected agents, per-agent destinations,
and files to add, update or remove. File counts include bundled references,
scripts and role agents; they are not counts of separate workflows. Use
`--verbose` for every target and the bundled component version. Existing files are copied byte-for-byte to
`~/.planr/backups/` with hashes and a migration manifest. Only managed marker
blocks are replaced; content outside those blocks is preserved.

When Claude Code is selected at user scope, the preview includes the marketplace
and plugin operations. Confirmed setup writes a generated local marketplace
(`openplanr-local`) from the installed package and installs or updates the OpenPlanr
plugin (`planr@openplanr-local`) from it, so the plugin always matches the CLI version. Setup never
reads the remote `openplanr/marketplace` for versions. The piped installer never
does this on its own. Restart Claude Code when setup says a plugin changed.

### Installation channels

| Channel | Purpose | Status |
| --- | --- | --- |
| `npm i -g openplanr`, then `openplanr setup` | Primary installation; the plugin is pinned to the CLI | Available |
| `openplanr/marketplace` | Optional direct Claude Code installation | Available; can trail the npm release |
| Anthropic marketplace listing | Vendor discovery and trust | Not yet listed |
| OpenAI Plugins Directory | Vendor discovery for Codex and supported ChatGPT surfaces | Not yet listed |

The release workflow projects each published `openplanr` Claude plugin into
`openplanr/marketplace`; the source stays in this repository. Use one Claude Code
channel per machine: either `openplanr setup` or
`/plugin marketplace add openplanr/marketplace`, not both.

For CI and provisioning, supply choices explicitly:

```bash
openplanr setup --runtime auto --scope user --yes
openplanr setup --runtime codex --scope project --yes
openplanr setup --runtime all --scope both --yes
openplanr runtime update claude --scope user --yes
```

Repeated setup is idempotent. To restore the last pre-setup state:

```bash
openplanr runtime rollback
```

Installing or updating one adapter is additive: it keeps every other managed
adapter and preserves each adapter's existing scope. For example, adding Codex
at user scope does not widen an existing project-only Cursor installation.

Setup installs the bundled OpenPlanr skills for the selected coding agents.
`openplanr doctor` reports managed-file drift and runtime availability.

### Exact runtime packages and thin project entries

Setup verifies the complete generated host package against its content inventory.
Integrations with thin entries retain those exact bytes under
`~/.planr/runtime/packages/<host>/<version>/<content-digest>/`. Set `PLANR_HOME`
to relocate OpenPlanr's runtime state, package cache and backups together; supported
legacy home overrides remain readable. `CODEX_HOME` independently selects Codex's
native profile, not OpenPlanr's package cache.

Direct and project integrations contain native discovery metadata plus a small
loader. Instructions, schemas, scripts and shared support stay in the exact cached
package. Loaders resolve from that package offline; they do not search for a global
CLI, download a substitute or silently select another version. Project Claude role
agents resolve every bundled reference from the same package. Native plugin
packages and standalone skill archives remain complete. User-only native plugin
installs do not create an unused duplicate home cache.

Machine-specific loaders and locators are local installation outputs. Regenerate
them with setup on each machine instead of sharing absolute cache paths in Git.
Project policy and runtime locks keep portable version and digest records. An
unchanged managed full-copy installation converts transactionally to thin entries;
unknown or edited files cause a conflict and are preserved. Old exact package
versions are retained, including those needed by existing runs. Setup does not
collect or remove historical runtime packages.

Use `--dry-run --verbose` to inspect both local discovery writes and cache writes.
A repeat setup shows unchanged operations. Doctor verifies the pinned full closure,
so missing or changed shared support is visible even when a skill entry is intact.
An interrupted copy with missing bytes can resume from the same reviewed package;
changed bytes in an immutable cache are preserved and reported for inspection.
Package staging lives outside the closed package tree, so an interrupted staged
copy cannot pollute its inventory. Orphan staging is retained. Unknown temporary
files left in a discovery directory after a hard interruption require inspection;
repair does not guess that arbitrary files are safe to delete.

## Codex skill modes

The wizard uses product names; existing `--skill-mode` values remain compatible:

- **OpenPlanr plugin** (`unified-plugin`, recommended): one `planr` plugin registered through Codex's plugin
  marketplace; skills are invoked as `$planr:<skill>`.
- **Individual skills** (`direct`): short discovery entries installed under the
  effective `CODEX_HOME/skills/<name>/` at user scope or `.agents/skills/<name>/`
  at project scope, invoked by bare names such as `$spec`.
- **Project skills** (`project-rule`): short discovery entries installed under
  `.agents/skills/` in the current project only.

Every installed asset is digest-verified. Switching from individual Codex skills
to the plugin backs up and removes only the recorded OpenPlanr-owned files from
`~/.codex/skills/`. Modified or unknown content is preserved and reported as a
conflict. The plugin comes from the installed CLI; it is not downloaded from an
unrelated marketplace. For plugin or direct user discovery, selecting both
scopes adds project policy pointing to that discovery instead of duplicate skills.
An existing saved project-only choice remains recorded for later scope changes.
Guided setup asks once to confirm the listed replacement and apply setup. For
non-interactive use, review `--dry-run --verbose`, then add `--replace-managed`.
Use `openplanr runtime rollback` to restore the previous file state.

## Project stack overrides

Place shared project stack conventions under `.planr/stacks/` and list their
logical paths in `input/tech/stack.md`'s `ActiveStackFiles`. Installed defaults
remain available. For each logical path, project resolution uses `.planr/stacks/`
first, then the selected runtime's legacy `.claude/stacks/`, `.codex/stacks/` or
`.cursor/stacks/`, then `.openplanr/stacks/`. A foreign host's folder never selects
a runtime implicitly. Different legacy bytes produce a conflict diagnostic;
resolution does not mix or overwrite them.

## Operate cycles

The Operate set is `operate` plus the seven `ceo`, `cto`, `cpo`, `cmo`, `coo`,
`challenger`, and `chair` reviews. Invoke `$planr:operate` (Codex) or `/planr:operate`
(Claude Code) for the guided local review. It uses current-snapshot defaults, asks
through the host's native question surface only for consequential ambiguity, and
reports a missing lens as a visible issue instead of blocking the rest of the report.

The validator is optional editing help for any generated note:

```bash
openplanr operate validate-note <note.md> --profile advisor|challenger|chair|board-report --contract-version 2.0.0 --json
```

Omit `--contract-version` to auto-detect current v2 and historical v1 notes.

The durable Operate runtime is separate. Discover its exact registered domain
identity with `openplanr operate domains --json`; neither setup nor the runtime
guesses a domain version. Its issued executors receive a prepared packet and use
only:

```bash
openplanr operate assignment prepare <assignmentId> --actor <agentId> --runtime codex --json
openplanr operate assignment validate <packetId> --content-file <resultPath|-> --json
openplanr operate assignment submit <packetId> --content-file <resultPath|-> --json
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
openplanr doctor --strict --json
openplanr setup --dry-run
openplanr upgrade status
openplanr upgrade apply
```

- Missing or stale skills: inspect doctor output, then re-run `openplanr setup`.
  Known owned bytes are repaired transactionally; unknown or modified files are
  preserved and reported as `E_MIGRATION_CONFLICT`.
- First Cycle rejects `--domain-version`: run `openplanr operate domains --json`
  and copy the exact domain identity. Operate Protocol `2.0.0` is not a domain
  version.
- Assignment prepare/validate/submit fails: use the returned machine `code` and
  `problem`. The CLI intentionally omits host paths and stacks; author only the
  returned `resultPath` and keep `packetId` unchanged.
- CLI/skill parity is incompatible: run `openplanr upgrade status`, then the
  explicit `openplanr upgrade apply`, then the commands it lists for your coding
  agents, and `openplanr doctor --strict --json` again.

## Offline, remote, and SSH use

After the package and runtime assets are installed, planning artifacts, runtime
routing, status, sync audit, dashboard, design boards, diagrams, and doctor work
without network access. Only tracker sync (GitHub, Linear) and company workspaces
reach the network.

On remote/SSH machines use `--scope user` for reusable skills and `--scope project`
for repository policy. Forward a loopback port explicitly through SSH when a
local artifact-review browser runs elsewhere.

## Windows

The PowerShell installer and the CLI support a supported Node.js version (see [package metadata](../package.json)) on Windows. Project paths in
committed runtime locks and project policy are path-free. Thin discovery entries
contain machine-specific cache paths and must be regenerated locally. Ownership
state and backups remain in the selected OpenPlanr home.

## Security

- No telemetry is added.
- Setup never installs Node or deletes unknown user files.
- `doctor --fix` can remove legacy project files accidentally installed under
  `$HOME`, but only when their recorded ownership hashes still match.
- `doctor --fix` can remove unreachable design/dashboard daemon state after a
  preview and second health check; it never kills or inspects unrelated processes.
- `doctor` inspects native plugin state read-only. `doctor --fix` previews managed
  plugin repair through native commands using the bundle in the running CLI. It
  preserves saved installation scopes and the Codex discovery choice, backs up
  owned-file changes, and requires confirmation before retiring managed identities.
  Unrelated plugins and owner-modified files are preserved. Restart the affected
  host when requested; file and registration health does not prove live discovery.
- Credentials are not written to runtime locks or provenance.
- Doctor redacts secrets and only fixes owned files after preview.
- Provenance is append-only. Recovery requires an explicit event rather than
  fabricated history.

### Codex profiles and installed skill evidence

Setup, runtime updates, removal and doctor use the effective `CODEX_HOME` (default
`~/.codex`). One shared ownership file, setup lock and transaction backup tree keep
Claude and Cursor records stable. Its private profile index retains each alternate
Codex user bundle separately, keyed by the canonical native home. The historical
default-profile bundle stays in place. A repair in one profile
cannot retire another profile's direct skills. Run the command with the same
`CODEX_HOME` as the Codex session you want to configure.

`openplanr doctor --json` includes `codexDiscovery`: the effective profile, configuration
and ownership paths, saved discovery mode, and each installed OpenPlanr skill's
entrypoint, complete source hash, skill version and Protocol version. Thin entries
also pin the complete package inventory digest; shared support is verified against
that inventory. The CLI/host package version is a separate field. Missing support
files invalidate the closure even when `SKILL.md` and its version are unchanged. Multiple discovery paths are
reported without claiming which one an already-open Codex session loaded. Disabled
or historical plugin cache copies are evidence of previous installations, not
proof of enabled duplicate skills.

Use `openplanr setup --runtime codex --dry-run` or `openplanr doctor --fix` to preview
installer-owned repairs in that profile. Review the changes and restart Codex to
reload its skills. Do not manually delete native plugin caches. Unknown files and
hand edits retain the existing ownership/conflict protections.

`openplanr upgrade status` labels its release-metadata source. `stale-cache` means the
registry request failed and a previous result was reused; compatibility with that
cached set does not confirm the latest release. `cache` means recently cached
metadata was used without a new registry request. Only `network` is a fresh check.

`openplanr runtime update <agent>` refreshes only the named agent, retaining its saved
scope and Codex discovery mode. An explicit `--scope` changes that agent's scope;
the preview includes any retirement of unchanged managed project files and keeps
their exact backup for rollback. Shared project lock records and other agents' owned
files remain present. To deliberately change a Codex mode, use `openplanr setup` with
`--skill-mode` and review its transition preview.
