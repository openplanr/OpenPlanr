# OPERATE-SPEC-013 — Setup pin fix

Release participant: `openplanr@1.25.1`

Contract dependency: `planr-pipeline@0.41.0` / Protocol v1.4.0.

Umbrella spec: `SPEC-007`.

## Scope

`planr setup` failed on every correctly-installed machine. The CLI pins its pipeline
sibling exactly in `optionalDependencies` and resolves the *installed* copy's version
to decide which Claude plugin version to expect, compared by strict equality. 1.25.0
shipped that pin at `0.40.0` while publishing alongside pipeline `0.41.0`, so a
user's correct 0.41.0 plugin read as drift: `E_CLAUDE_PLUGIN_UPDATE_FAILED`, followed
by a rollback. The skills target constant was stale the same way.

No gate caught it. Every suite sets `OPENPLANR_PIPELINE_ROOT` to a source checkout,
which bypasses the `node_modules` resolution the pin governs — the tested
configuration never matched the installed one on that axis.

## Required behavior

- The declared pipeline pin and the skills target track the released tuple.
- A parity guard fails CI when either goes stale: the declared pin is compared
  against the pipeline the environment resolves, and against every
  `openplanr/planr-pipeline` checkout ref in `.github/workflows`.
- Verified on the published artifact, not a local build: `openplanr@1.25.1`
  installed from npm onto a clean `HOME` completes `planr setup`.

## Ledger

Recorded as `OPERATE-SPEC-013` in `openplanr/marketplace`.
