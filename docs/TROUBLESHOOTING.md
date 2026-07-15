# Troubleshooting

Common issues and how to resolve them.

Start with the unified health check:

```bash
planr doctor --json
planr setup --dry-run
```

`doctor --fix` previews owned generated-file repairs. Package installation,
version changes, provenance recovery, credential changes, and deletion remain
explicit confirmation gates.

## Runtime setup and migration

- `E_NODE_VERSION`: install Node.js 20 or newer; the installer never changes Node.
- `E_PROJECT_CONTEXT_REQUIRED`: change into a Git or initialized OpenPlanr
  project before selecting project scope, or use `--scope user`.
- `E_RUNTIME_AMBIGUOUS`: pass `--runtime` or set a project default.
- `E_LOCK_INCOMPATIBLE`: run the exact `planr runtime update ...` command shown.
- `E_MIGRATION_CONFLICT`: a managed file changed after setup; preview, preserve
  the edit, or use `planr runtime rollback`.
- `E_PROVENANCE_WRITE`: repair permissions, then append an explicit recovery
  event; doctor never invents history silently.

Setup backups live under `~/.planr/backups/<project-hash>/<timestamp>/`. Machine
state and paths live under `~/.planr/runtime/state.json`; the committed project
lock contains only versions and compatibility capabilities.

If an older installer created `~/CLAUDE.md`, `~/AGENTS.md`, Cursor rules, or a
home-directory runtime lock, `planr doctor` reports `home-project-install`.
Run `planr doctor --fix` to preview removal. Only recorded OpenPlanr-owned bytes
are removed; user-scope adapters and hand-written content are retained.

---

## "No .planr/config.json found"

You need to initialize Planr in your project first:

```bash
planr init
```

If you're running from a subdirectory, use `--project-dir`:

```bash
planr status --project-dir /path/to/project
```

---

## AI provider errors

### "Invalid API key"

Your API key is missing or incorrect. Set it with:

```bash
planr config set-key anthropic
# or
planr config set-key openai
```

Keys are stored in `~/.planr/credentials.json`. You can also set them via environment variables:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

### "Rate limited"

You've hit the provider's rate limit. Wait a moment and try again. The error message will indicate how long to wait.

### "Could not connect to Ollama"

If using Ollama, make sure it's running:

```bash
ollama serve
```

By default, Planr connects to `http://localhost:11434`. To use a different URL, set it in your config.

---

## "AI not configured"

Commands like `planr plan`, `planr refine`, and AI-powered `planr task create` require an AI provider. Set one up:

```bash
planr config set-provider    # choose anthropic, openai, or ollama
planr config set-key         # enter your API key
```

Manual mode (no AI) is available for `planr epic create`, `planr feature create`, `planr story create`, and `planr task create --story`. `planr task create --feature` always requires AI.

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

The bundler accepts only resolvable files below `--root`. Remote URLs, forms,
path traversal, symlink escapes, and unresolved dependencies are rejected by
design. Vendor the dependency locally or choose the correct asset root.

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

The linked GitHub issue was deleted. Planr handles this gracefully — it will create a new issue on the next push. If you see this error during sync, re-push the artifact:

```bash
planr github push EPIC-001
```

### Push creates duplicate issues

Each artifact stores its linked issue number in frontmatter (`githubIssue: 123`). If you manually delete this field, a new issue will be created on the next push. Don't edit `githubIssue` fields manually.

---

## Build and development issues

### "Cannot find module" errors after changes

Rebuild the project:

```bash
npm run build
```

Templates are copied during build. If you modified templates in `src/templates/`, they won't take effect until you rebuild.

### Tests failing locally

Make sure you have the correct Node.js version:

```bash
node --version    # should be >= 20.0.0
```

Install dependencies and run tests:

```bash
npm ci
npm test
```

---

## Still stuck?

Open an issue at [github.com/openplanr/OpenPlanr/issues](https://github.com/openplanr/OpenPlanr/issues) with:

- The command you ran
- The full error output
- Your Node.js version (`node --version`)
- Your OS
