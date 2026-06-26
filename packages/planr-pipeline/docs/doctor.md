# OpenPlanr Doctor

`npm run doctor` is the local health check for the OpenPlanr ecosystem. It is
safe to run before every PR and release; it does not mutate files.

Use `npm run ecosystem:conformance` alongside doctor when validating cross-repo
graph compatibility with the OpenPlanr CLI.

## Commands

```bash
npm run doctor
npm run doctor:versions
npm run doctor -- --strict
npm run doctor -- --release
npm run doctor -- --release --strict
npm run doctor -- --json
```

## Modes

| Mode | Purpose |
|---|---|
| default | Reports local environment, versions, protocol docs, sibling repos, daemons, and credentials. Warnings exit `0`. |
| `--strict` | Promotes ecosystem and release drift warnings to failures. Use before merge. |
| `--release` | Checks tags and GitHub releases for current pipeline, skill, and CLI versions when sibling repos exist. |
| `--json` | Emits machine-readable output with `ok`, `failures`, `warnings`, and `checks`. |
| `--versions-only` | Runs the version/protocol/ecosystem subset used by `npm run doctor:versions`. |

## Output Contract

```json
{
  "ok": true,
  "failures": 0,
  "warnings": 0,
  "checks": [
    {
      "id": "versions.package-plugin",
      "status": "ok",
      "severity": "info",
      "message": "package.json and .claude-plugin/plugin.json agree"
    }
  ]
}
```

Check statuses are `ok`, `warn`, or `fail`. Severities are `info`, `warning`,
or `error`. Failures exit `1`; warnings exit `0` unless `--strict` promotes
them.

## Common Fixes

| Check area | Fix |
|---|---|
| Versions | Update `package.json`, `.claude-plugin/plugin.json`, `input/tech/stack.md`, protocol docs, and compatibility docs together. |
| Protocol | Keep schemas under `schemas/v1.0.0/` canonical and use `qa_gate_status` values `passed`, `failed`, `skipped`. |
| Ecosystem | Update sibling marketplace, skills, and OpenPlanr docs after owner repo changes. |
| Daemons | Remove stale state under `~/.planr/design-daemon/` or `~/.planr/dashboard-daemon/`, then restart the command. |
| Credentials | Keep project `.env` files with `OPENAI_API_KEY` ignored, or move the key to user-level credentials. |
| Releases | Create the missing tag or GitHub release, then rerun `npm run doctor -- --release --strict`. |
