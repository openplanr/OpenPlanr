# Cross-runtime setup and operations

## Install

```bash
curl -fsSL https://openplanr.dev/install.sh | sh
# PowerShell
irm https://openplanr.dev/install.ps1 | iex
```

The installer requires Node.js 20+ and never installs or upgrades Node silently.
The full pipeline is the default. Use `--minimal` for dedicated planning only,
or `npx openplanr@latest setup` without a global install.

## Preview, apply, and migrate

```bash
planr setup --runtime auto --scope both --dry-run
planr setup --runtime auto --scope both
planr doctor
```

Setup detects Claude Code, Codex, and Cursor, then prints every target and
operation before mutation. Existing files are copied byte-for-byte to
`~/.planr/backups/` with hashes and a migration manifest. Only managed marker
blocks are replaced; content outside those blocks is preserved.

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
- Credentials are not written to runtime locks or provenance.
- Doctor redacts secrets and only fixes owned files after preview.
- Provenance is append-only. Recovery requires an explicit event rather than
  fabricated history.
