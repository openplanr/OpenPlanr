# OPERATE-SPEC-009 marketplace work item

This repository is the durable, initially unmerged release ledger for the
SPEC-005 durable-orchestration coordinated release. It records the version tuple
the coordinated saga targets and stays **withheld** until the real-runtime
canary passes against the published artifacts on every supported runtime.

Umbrella spec: `SPEC-005` (per-role durability, honest state, and a
one-invocation review gate).

## Staged tuple

- Protocol `1.4.0`
- `planr-pipeline@0.39.0`
- `openplanr@1.22.0`
- `@openplanr/skills@1.24.0`
- marketplace `1.9.0`

This tuple closes the durability gap that lost a real credentialed run: the
advisor fan-out that deadlocked on a hung lens is replaced by a deterministic
lifecycle driver that records each advisor result the instant it returns, keeps
the session alive with an automatic heartbeat lease, persists partial validated
progress, reports honest state, and consolidates a partial board at the Chair
without inventing a missing lens's conclusions.

## Two-step ledger discipline

This entry is the **staging** half of the two-step marketplace finalization
(`merge-unavailable-ledger` → `tag-and-verify-marketplace` →
`record-finalization-and-expose`). Consistent with every prior coordinated
release in this repository, staging:

- carries the top-level `components.pipeline/cli/skills` at the last **verified**
  tuple (`0.38.0` / `1.21.2` / `1.23.0`) — an unpublished tuple is never
  advertised as released;
- moves the marketplace component to `1.9.0`, the artifact validated on this
  release branch;
- exposes the candidate `0.39.0` / `1.22.0` / `1.24.0` / `1.9.0` tuple inside the
  withheld `agenticOperatingBoard` capability with `status: unavailable` and
  `missing: ["release"]`, bound to operation `OPERATE-SPEC-009` in
  `state: drafted` with `reconciliation: pending`.

The generated `ecosystem.json` records exactly this staged shape. Nothing here
claims verification that has not happened: no participant is published, tagged,
or reconciled, and the release evidence is `pending`.

## Release transaction

Release order is `planr-pipeline@0.39.0` → `openplanr@1.22.0` →
`@openplanr/skills@1.24.0` → marketplace ledger and real-runtime canary. Every
repository retains its own branch, CI, PR, tag, package, and rollback boundary.
Because no participant is published, recovery is `compensate-before-publish`:
the unmerged release PRs may be closed and the manifest withheld without any
forward-fix obligation.

The resolved capability will certify Claude Code, Codex, and Cursor. Codex and
Cursor honestly report runtime-governed advisory isolation; both remain
supported under runtime-governed assurance. Every cycle is sticky to its
selected runtime and cross-runtime fallback is forbidden.

## Finalization gate

This ledger may be finalized only after the exact package tuple is published and
tagged and the full real-runtime canary passes: a complete Operate cycle through
the review gate on each supported runtime, the intentionally-stalled-role
durability scenario, terminate-and-resume, the large-monorepo/gitignored-`.planr`
run, the transport-hiding transcript scan, and cross-platform reconciliation on
the Ubuntu, macOS, and Windows Node 20/22 matrix. The real-runtime canary steps
that certify this tuple live in
`.github/workflows/operating-canary.yml`; their evidence artifacts attach to the
canary run that finalizes this entry. Publication in any participant changes
recovery to forward-fix; no repository pretends the ecosystem release is
globally atomic.
