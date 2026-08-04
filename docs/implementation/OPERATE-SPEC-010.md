# OPERATE-SPEC-010 — Installed-tuple reconciliation

Release participant: `openplanr@1.23.0`

Contract dependency: `planr-pipeline@0.39.0` / Protocol v1.4.0.

Umbrella spec: `SPEC-006`.

## Scope

The CLI reports what is *installed* against what is *published*, and prescribes the
exact commands that close the gap. Before this release the upgrade surface could
describe a tuple the machine did not actually have, because the reconciliation read
intent rather than installed state.

## Required behavior

- `planr upgrade status` reconciles the installed tuple — CLI, skills plugin, and
  pipeline plugin — against the published compatible set, and states which of the
  two it is reading (network manifest or bundled fallback).
- When the installed tuple has drifted, the prescription names every command needed,
  including the plugin-half commands the CLI does not run itself.
- Verified at `openplanr@1.23.0` on npm with SLSA provenance, pinned to
  `planr-pipeline@0.39.0`.

## Ledger

Recorded as `OPERATE-SPEC-010` in `openplanr/marketplace`
(`docs/implementation/OPERATE-SPEC-010.md` there carries the release evidence).
