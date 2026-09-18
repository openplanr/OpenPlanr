# Troubleshooting

Common issues and how to resolve them.

Start with the unified health check:

```bash
planr doctor --json
planr setup --dry-run
```

`doctor --fix` previews owned generated-file repairs and stale OpenPlanr daemon
state. It asks once, rechecks daemon health, and removes only OpenPlanr-owned state;
it never kills a process. Package installation, version changes, provenance
recovery, credential changes, and unrelated deletion remain explicit gates.

An unavailable runtime is informational unless setup or the project lock
actually selected it. A selected runtime that disappears remains a warning.

## Runtime setup and migration

- `E_NODE_VERSION`: install Node.js 20 or newer; the installer never changes Node.
- `E_PROJECT_CONTEXT_REQUIRED`: change into a Git or initialized OpenPlanr
  project before selecting project scope, or use `--scope user`.
- `E_RUNTIME_AMBIGUOUS`: pass `--runtime` or set a project default.
- `E_LOCK_INCOMPATIBLE`: run the exact `planr runtime update ...` command shown.
- `E_MIGRATION_CONFLICT`: a managed file changed after setup; preview, preserve
  the edit, or use `planr runtime rollback`.
- `E_CLAUDE_PLUGIN_INSPECTION_FAILED`: update Claude Code so its plugin manager
  is available, then rerun `planr setup --runtime claude --scope user`.
- `E_CLAUDE_PLUGIN_UPDATE_FAILED`: verify GitHub/marketplace connectivity, run
  `planr runtime update claude --scope user`, and restart Claude Code.
- `E_PROVENANCE_WRITE`: repair permissions, then append an explicit recovery
  event; doctor never invents history silently.

If doctor reports `runtime-claude-plugins`, the installed plugin version or
manifest identity does not match the compatible release. Run:

```bash
planr runtime update claude --scope user
```

Review and confirm the listed marketplace and plugin operations, then restart
Claude Code. Setup serves the unified `planr` plugin from a generated local
marketplace (`openplanr-local`). Older `openplanr` or `planr-pipeline` plugins from
the public marketplace are reported as legacy and never removed silently; confirm
the unified plugin works, then remove them from Claude Code.

Setup backups live under `~/.planr/backups/<project-hash>/<timestamp>/`. Machine
state and paths live under `~/.planr/runtime/state.json`; the committed project
lock contains only versions and compatibility capabilities.

If an older installer created `~/CLAUDE.md`, `~/AGENTS.md`, Cursor rules, or a
home-directory runtime lock, `planr doctor` reports `home-project-install`.
Run `planr doctor --fix` to preview removal. Only recorded OpenPlanr-owned bytes
are removed; user-scope adapters and hand-written content are retained.

---

## Skills

### A skill is not found in the host

Confirm setup targeted that host and scope (`planr doctor --json` lists every
managed installation), then restart the host so it reloads its skills. Codex uses
one install mode at a time; preview with `planr setup --runtime codex --dry-run`
before switching modes.

### A skill asks for an API key or runs a planning command

That is an old projection. Current skills reason inside the coding agent and call
only deterministic `planr` utilities. Run `planr setup` again, restart the host, and
check `planr upgrade status`.

### The agent does not pick the right skill

Generate the host guidance so the agent sees every skill and its triggers:

```bash
planr rules generate --target claude   # or codex, cursor, all
```

Then ask for `/planr:openplanr` (Claude Code) or `$planr:openplanr` (Codex), which
routes a request to the best skill.

## "No .planr/config.json found"

Initialize OpenPlanr in the project first:

```bash
planr init
```

If you're running from a subdirectory, use `--project-dir`:

```bash
planr status --project-dir /path/to/project
```

---

## Artifact review issues

### `E_PIPELINE_NOT_INSTALLED`

Artifact review is part of the full distribution. A planning-only install made
with `--minimal` omits it. Install the full package and verify again:

```bash
npm install -g openplanr@latest
planr doctor
```

### `E_ARTIFACT_STALE_REVIEW`

The returned review targets a different artifact digest. Do not merge it
silently. If the older feedback is still useful, rerun the import with
`--allow-stale`, inspect the preview, and confirm. CI must also pass `--yes`.

### A remote or SSH browser cannot reach the local review

`planr artifact` intentionally binds to `127.0.0.1`. Use `--no-open --json`,
then forward the printed port over SSH. Do not bind the review server publicly.

### An artifact dependency is rejected

The bundler resolves local dependencies below `--root` (the artifact's directory
by default) and vendors supported public HTTPS dependencies automatically. It
still rejects forms, path traversal, symlink escapes, private or non-HTTPS
hosts, unsupported resources, and unresolved dependencies. Use `--root` when
the artifact intentionally depends on a larger local asset tree.

See [Artifact review and private sharing](ARTIFACT_REVIEW.md) for the complete
privacy and sharing model.

---

## Cross-reference issues

### Links point to wrong files

If artifacts were renamed or moved manually, cross-references may break. Run:

```bash
planr sync --dry-run    # preview what would change
planr sync              # fix broken links
```

### "Stale link" warnings

A parent artifact links to a child that no longer exists on disk. `planr sync` removes these automatically.

### "Missing link" warnings

A child artifact references a parent, but the parent doesn't list the child. `planr sync` adds the missing link.

---

## Template issues

### Custom templates not loading

Make sure `templateOverrides` in `.planr/config.json` points to the correct directory:

```json
{
  "templateOverrides": "./my-templates"
}
```

The override directory must mirror the default template structure (e.g., `my-templates/epics/epic.md.hbs`). Only files that exist in the override directory will be used — all others fall back to defaults.

---

## GitHub integration issues

### "GitHub CLI (gh) is not installed"

The `planr github` commands require the GitHub CLI. Install it:

```bash
# macOS
brew install gh

# Other platforms: https://cli.github.com/
```

### "Not authenticated with GitHub"

You need to log in with `gh`:

```bash
gh auth login
```

### "No GitHub remote found"

Your repository doesn't have a GitHub remote configured. Add one:

```bash
git remote add origin https://github.com/your-org/your-repo.git
```

### "Could not resolve to an issue"

The linked GitHub issue was deleted. The CLI creates a new issue on the next push. If you see this error during sync, re-push the artifact:

```bash
planr github push EPIC-001
```

### Push creates duplicate issues

Each artifact stores its linked issue number in frontmatter (`githubIssue: 123`). If you manually delete this field, a new issue will be created on the next push. Don't edit `githubIssue` fields manually.

---

## Working from a source checkout

Build and test failures inside the repository are covered by the contributor guide,
[Working from a checkout](https://github.com/openplanr/OpenPlanr/blob/main/docs/contributing/dogfooding.md).

---

## Still stuck?

Ask in [Discussions](https://github.com/openplanr/OpenPlanr/discussions) or open an
issue through the [issue forms](https://github.com/openplanr/OpenPlanr/issues/new/choose)
with:

- the command or skill invocation and the full output
- `planr --version` and `planr doctor --json` (doctor redacts secrets; check anyway)
- the host and its version, your operating system, and `node --version`
