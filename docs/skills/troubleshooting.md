# Skill installation troubleshooting

Start with the exact local binary and machine-readable doctor output:

```bash
/path/to/OpenPlanr/node_modules/.bin/planr doctor --json
```

## Skill not found

Confirm setup selected the intended host, then restart it. Codex should use one
install mode. Claude should see the generated local marketplace and enabled
`openplanr` plugin. Do not copy generated skills manually into host caches.

## Couldn't load files

Regenerate and run the installed-content canaries:

```bash
npm run generate
npm run skill:verify:codex-plugin
npm run skill:package
npm run skill:verify:release
```

A missing or incorrectly cased reference now fails with a typed source line and
repair. Fix the canonical skill/module; never patch a cache or adapter output.

## Duplicate skills

Doctor distinguishes manifest-owned direct skills, the managed unified plugin,
and unrelated user plugins. Preview the intended mode and use
`--replace-managed` to retire only the previously managed mode. Unknown or
modified user files are reported and preserved.

## Stale marketplace or cache

Run setup again from the intended workspace binary, restart the host, and check
doctor's installed content identity as well as its version. A same-version
Claude package with old `commands/`, aliases, or `codex-skills/` is reinstalled
from the current generated package. Do not delete arbitrary host caches: setup
owns the exact managed marketplace/plugin transition and can explain stale
state.

## A skill invokes `planr spec decompose` or asks for an AI API key

That is an old skill projection. The current Plan and Ship skills perform
semantic work in the active host and never launch a provider-backed CLI. Rerun
setup from this checkout, restart the host, and verify the plugin has 25 skills
and no generated commands or aliases.

## Unsupported host capability

The skill falls back through the declared host profile: native question, chat,
terminal, then a safe headless branch where one exists. Missing optional input
does not block useful work. A genuinely required decision is reported with the
available next action.

## CLI/runtime mismatch

Compare `planr --version`, the exact optional `planr-pipeline` version in the
workspace, and doctor output. Rebuild the workspace and rerun setup from the
same checkout so the CLI, plugin, adapters, and runtime lock share one generated
catalog.
