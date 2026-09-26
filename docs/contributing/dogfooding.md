# Working from a checkout

Use this guide to build OpenPlanr from source, install the skills it generates into
your own coding agent, and verify that what you built is what runs.

OpenPlanr requires Node.js 20 or later. CI verifies Node.js 20, 22, and 24;
contributors use Node.js 24 (`.nvmrc`).

## Build

```bash
git clone https://github.com/openplanr/OpenPlanr.git
cd OpenPlanr
npm ci
npm run generate
npm run build
npm run test:focused
```

`npm run generate` writes the checked-in projections and the ignored host packages
under `dist/plugins/`; `npm run build` compiles the CLI. Both must run before any
check mode, because check mode validates existing output and never bootstraps it.

## Use the checkout's CLI

Call the workspace binary explicitly so a globally installed `planr` is never
confused with the one you are testing:

```bash
PLANR_BIN="$PWD/node_modules/.bin/planr"
"$PLANR_BIN" --version
```

Never run `npx openplanr` inside this repository; it resolves the published package,
not your build.

## Install the generated skills

Preview, then apply, for the host you use:

```bash
"$PLANR_BIN" setup --runtime claude --scope user --dry-run --json
"$PLANR_BIN" setup --runtime claude --scope user --yes

"$PLANR_BIN" setup --runtime codex --scope user --skill-mode unified-plugin --dry-run --json
"$PLANR_BIN" setup --runtime codex --scope user --skill-mode unified-plugin
```

Claude Code receives a generated local marketplace (`openplanr-local`) and the unified
`planr` plugin; Codex receives the same plugin through its marketplace. Restart the
host afterwards. Setup compares the installed content identity with the generated
package, so a same-version install that still carries legacy `commands/`, aliases, or
`codex-skills/` is replaced.

Verify from the outside:

```bash
"$PLANR_BIN" doctor --json
```

Doctor must report one install mode per host and the same content identity the
generated package carries. In the host, open the plugin's contents: the skill count
must equal the canonical registry (see [the generated catalog](../generated/skills.md)),
Claude Code must list nine agents and no commands, and every skill must open with its
support files.

To use the checkout against another project, keep calling the explicit binary:

```bash
OPENPLANR_REPO=/path/to/OpenPlanr
cd /path/to/project
"$OPENPLANR_REPO/node_modules/.bin/planr" status --md
```

Plan and ship must work when `planr` is absent from `PATH` and the network is
unavailable: the host agent authors and implements; the CLI provides no semantic
fallback.

## Verify before you push

```bash
npm run generate && git diff --exit-code HEAD --
npm run check:generated
npm run check:boundaries
npm run check:diagrams
npm run lint
npm run test:focused
```

`npm run verify` bundles the check and focused gates with the packed-package proof;
`npm run verify:ci` replays the Workspace CI jobs in order (`--list`, `--only`, `--skip`).
`npm run lint` runs Biome over every workspace from the root `biome.jsonc`; `npm run lint:fix`
applies its safe fixes and `npm run format` its formatting.

Skill changes have their own loop:

```bash
npm run skill:lint -- skills/planr-<name>
npm run skill:preview -- skills/planr-<name>
npm run skill:generate
npm run skill:check
npm run skill:check:parity
npm run skill:check:purity
npm run skill:package
npm run skill:verify:release
```

Generated packages under `dist/plugins/` and archives under `release/` are ignored by
Git. Commit canonical sources and their checked-in projections only.

## Troubleshooting

Start with the exact binary and machine-readable output:

```bash
"$PLANR_BIN" doctor --json
```

**A skill is not found.** Confirm setup targeted the intended host and restart it.
Codex must use one install mode. Do not copy generated skills into host caches by hand.

**A support file fails to load.** Regenerate and run the installed-content checks:

```bash
npm run generate
npm run skill:verify:codex-plugin
npm run skill:package
npm run skill:verify:release
```

A missing or wrongly cased reference fails with the source line to fix. Fix the
canonical skill or shared module, never the generated output.

**Duplicate skills.** Doctor distinguishes manifest-owned direct skills, the managed
unified plugin, and unrelated user plugins. Preview the intended mode and pass
`--replace-managed` to retire only the previously managed mode; unknown or modified
files are preserved and reported.

**Stale marketplace or plugin.** Rerun setup from the intended checkout, restart the
host, and compare doctor's content identity with the generated package. Do not delete
host caches; setup owns the marketplace and plugin transition.

**A skill asks for an API key or runs a planning CLI.** That is an old projection.
Current skills reason inside the host and never launch a model process. Rerun setup
from this checkout and restart the host.

**CLI and plugin disagree.** Compare `"$PLANR_BIN" --version`, the exact optional
`planr-pipeline` version in the workspace, and doctor output; rebuild and rerun setup
from the same checkout so the CLI, plugin, adapters, and runtime lock share one
generated catalog. `"$PLANR_BIN" upgrade status` reports the same comparison against
the published set.
