# Install OpenPlanr skills locally

Plugin-only use is the default experience. Semantic workflows execute in the
active coding agent; the optional CLI is used only to install the generated
package and for deterministic utilities.

## Build this private workspace

Node 26 is preferred for local development. Node 20 and 22 remain verified
compatibility targets.

```bash
cd /path/to/OpenPlanr
npm ci
npm run build
npm run generate
```

Use the workspace binary without replacing a globally installed package:

```bash
PLANR_BIN="$PWD/node_modules/.bin/planr"
"$PLANR_BIN" --version
```

## Recommended Codex installation

Preview the exact changes first, then apply the same command without
`--dry-run`:

```bash
"$PLANR_BIN" setup --runtime codex --scope user \
  --skill-mode unified-plugin --dry-run --json
"$PLANR_BIN" setup --runtime codex --scope user \
  --skill-mode unified-plugin
```

Restart Codex after a successful install so it reloads plugin discovery. You do
not need to uninstall an unrelated global `planr` binary merely to test this
workspace; invoke `PLANR_BIN` explicitly. Doctor reports which repository,
version, plugin, and discovery mode are active.

The unified plugin uses the concise `$planr:spec`, `$planr:plan`, and
`$planr:ship` names. Direct skill mode retains `$planr-spec`, `$planr-plan`, and
`$planr-ship` because those files do not have a plugin namespace.

## Recommended Claude Code installation

Claude Code uses the generated local marketplace and one native plugin with 24
skills and nine role agents:

```bash
"$PLANR_BIN" setup --runtime claude --scope user --dry-run --json
"$PLANR_BIN" setup --runtime claude --scope user --yes
```

Setup compares the installed content identity with the generated package. If a
same-version development install still contains legacy `commands/`, aliases, or
`codex-skills/`, it is replaced. Restart Claude Code, then invoke
`/planr:spec`, `/planr:plan`, or `/planr:ship`.

## Other Codex modes

```bash
# Individually managed user skills
"$PLANR_BIN" setup --runtime codex --scope user --skill-mode direct

# Current project only; no global skill discovery
"$PLANR_BIN" setup --runtime codex --scope project --skill-mode project-rule
```

When switching an existing OpenPlanr-managed mode, preview first and add
`--replace-managed` only after reviewing the listed managed retirements. The
installer removes only manifest-owned bytes and preserves unrelated or modified
user content. `planr doctor --json` explains duplicates or conflicts without
silently deleting them.

The generated individual archives and host packages live under ignored
`release/` after
`npm run skill:package`. They are local staging products, not public releases.
