# Troubleshooting

Common issues and how to resolve them.

---

## "No planr.config.json found"

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

Manual mode (no AI) is available for `planr epic create`, `planr feature create`, `planr story create`, and `planr task create`.

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

Make sure `templateOverrides` in `planr.config.json` points to the correct directory:

```json
{
  "templateOverrides": "./my-templates"
}
```

The override directory must mirror the default template structure (e.g., `my-templates/epics/epic.md.hbs`). Only files that exist in the override directory will be used — all others fall back to defaults.

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

Open an issue at [github.com/TechArc-io/OpenPlanr/issues](https://github.com/TechArc-io/OpenPlanr/issues) with:
- The command you ran
- The full error output
- Your Node.js version (`node --version`)
- Your OS
