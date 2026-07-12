# Cross-runtime setup and operations

## Install

```bash
curl -fsSL https://openplanr.dev/install.sh | sh
# PowerShell
irm https://openplanr.dev/install.ps1 | iex
```

The installer requires Node.js 20+ and never installs or upgrades Node silently.
It installs the CLI without changing the current directory. Then change into a
project and run guided setup:

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

For CI and provisioning, supply choices explicitly:

```bash
planr setup --runtime auto --scope user --yes
planr setup --runtime codex --scope project --yes
planr setup --runtime all --scope both --yes
```

Repeated setup is idempotent. To restore the last pre-setup state:

```bash
planr runtime rollback
```

Installing or updating one adapter is additive: it keeps every other managed
adapter and preserves each adapter's existing scope. For example, adding Codex
at user scope does not widen an existing project-only Cursor installation.

Removal deletes only recorded OpenPlanr-owned files whose hashes still match.
Modified or unknown files produce `E_MIGRATION_CONFLICT` before any adapter
bytes are removed. User-scope assets shared by multiple projects are
reference-safe: removing or rolling back one project retains them until no
other managed project installation depends on them.

## Offline, remote, and SSH use

After npm packages and runtime assets are installed, planning artifacts,
runtime routing, status, sync audit, dashboard, design boards, and doctor work
without fetching OpenPlanr sources. Provider-backed generation still requires
the selected provider or a local model runtime.

On remote/SSH machines use `--scope user` for reusable skills and `--scope project`
for repository policy. Boards bind only to loopback; forward a loopback port
explicitly through SSH when a browser runs elsewhere.

## Windows

The PowerShell installer and CLI support Node 20/22 on Windows. Project paths in
committed locks and generated rules are repository-relative. Machine-specific
absolute paths remain in the user runtime state and backups.

## Security

- No telemetry is added.
- Setup never installs Node or deletes unknown user files.
- `doctor --fix` can remove legacy project files accidentally installed under
  `$HOME`, but only when their recorded ownership hashes still match.
- Credentials are not written to runtime locks or provenance.
- Doctor redacts secrets and only fixes owned files after preview.
- Provenance is append-only. Recovery requires an explicit event rather than
  fabricated history.
