# OpenPlanr Doctor

`planr doctor` is the user-facing health check. The pipeline package also
provides `npm run doctor --workspace=planr-pipeline` for source and package
diagnostics. The default check does not mutate files.

Use the root conformance and generated-asset checks alongside Doctor when
validating workspace-wide compatibility.

## Commands

```bash
planr doctor
planr doctor --strict --json
npm run doctor --workspace=planr-pipeline -- --json
npm run doctor --workspace=planr-pipeline -- --repair-preview --json
npm run doctor --workspace=planr-pipeline -- --fix --json
```

## Modes

| Mode | Purpose |
|---|---|
| default | Reports local environment, versions, protocol docs, workspace domains, external web custody, daemons, and credentials. Warnings exit `0`. |
| `--strict` | Promotes ecosystem and release drift warnings to failures. Use before merge. |
| `--release` | Checks release state. It remains separate from ordinary local development checks. |
| `--json` | Emits machine-readable output with `ok`, `failures`, `warnings`, and `checks`. |
| `--versions-only` | Runs the version/protocol/ecosystem subset used by `npm run doctor:versions`. |
| `--repair-preview` | Reports safe Planr-owned stale-daemon repairs without changing files. |
| `--fix` | Rechecks daemon health and removes only stale Planr-owned daemon state. |
| `--workspace-root <path>` | Explicit directory used to locate the independent `openplanr-web` checkout or a legacy multi-repository layout. |

## Ecosystem Discovery

Doctor resolves source custody in this order:

1. `--workspace-root <path>`
2. `OPENPLANR_ECOSYSTEM_ROOT`
3. An ancestor `openplanr-workspace` containing `packages/pipeline`
4. The parent directory of a legacy standalone `planr-pipeline` checkout

In the consolidated workspace, Doctor checks `packages/cli`,
`packages/pipeline`, canonical `skills/`, root marketplace metadata, and
`ecosystem.json` in place. It does not ask for retired sibling skills,
marketplace, or CLI checkouts.

`openplanr-web` intentionally remains external. When its checkout is available,
Doctor verifies its independent package name plus `build`, `test`, and
`share:check` gates; otherwise the consolidated workspace reports its external
disposition as an informational passing check. That absence stays healthy under
`--strict` because the external service is not a local workspace dependency;
use an explicit workspace root or the external repository's own release checks
when its custody must participate in a release decision.
Legacy multi-repository discovery by checkout name or Git remote remains
readable for historical release work.

## Output Contract

```json
{
  "ok": true,
  "failures": 0,
  "warnings": 0,
  "checks": [
    {
      "id": "versions.runtime-package",
      "status": "ok",
      "severity": "info",
      "message": "planr-pipeline is a prompt-free runtime package"
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
| Versions | Update `package.json`, `input/tech/stack.md`, protocol docs, and compatibility docs together; host plugin versions are owned by the workspace. |
| Protocol | Keep schemas under `schemas/v1.0.0/` canonical and use `qa_gate_status` values `passed`, `failed`, `skipped`. |
| Ecosystem | Regenerate workspace metadata after internal domain changes; point Doctor at `openplanr-web` only when checking that external service. |
| Daemons | Run `planr doctor --fix`; it previews, confirms, rechecks, and removes only stale Planr-owned daemon state. |
| Credentials | Keep project `.env` files with `OPENAI_API_KEY` ignored, or move the key to user-level credentials. |
| Releases | Add the `## [<version>]` section to `CHANGELOG.md`, create the missing tag or GitHub release, then rerun `npm run doctor -- --release --strict`. |
