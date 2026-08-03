# OPERATE-SPEC-009 — Operate durable orchestration

Release participant: `openplanr@1.22.0`

Contract dependency: `planr-pipeline@0.39.0` / Protocol v1.4.0.

Umbrella spec: `SPEC-005` (per-role durability, honest state, and a one-invocation
review gate).

## Scope

OpenPlanr is the deterministic governance kernel for the SPEC-005 Operating Board.
This release closes the durability gap that lost a real credentialed run: the
advisor fan-out that deadlocked on a hung lens is replaced by a deterministic
lifecycle driver that records each advisor result the moment it returns, keeps the
session alive with an automatic heartbeat lease, persists partial validated
progress, reports honest state, and consolidates a partial board at the Chair
without inventing a missing lens's conclusions. Runtime agents still research the
workspace and reason as CEO, CTO, CPO, CMO, COO, and Chair; the CLI harnesses,
validates, records, and materializes reversible canonical proposal drafts.

## Required behavior

- Each advisor result is validated and recorded the instant it returns; recording
  never waits on the batch, and a recorded result survives a sibling stalling,
  interruption, lease expiry, and resume.
- The cycle lease is renewed by an engine-managed heartbeat independent of result
  recording; a slow lens can no longer expire completed roles. Raising the timeout
  is not the mechanism.
- A stalled non-required lens retries within a bounded budget, then resolves
  `not_evaluated` with a governed gap while its siblings record and the cycle
  proceeds to Chair.
- Mid-cycle `report` renders recorded lenses with their real analysis plus the
  exact recovery action for pending roles; an active advising cycle is never
  described as quiet.
- Chair consolidates the recorded, verified board and surfaces an absent lens as
  an explicit gap; it stays closed while a structurally-required role is only
  `not_evaluated`.
- Operate scratch lives under an OpenPlanr-owned, project-and-machine-keyed path
  recorded in an ownership manifest, cleaned automatically after record/finalize,
  detected by `doctor` when abandoned, and removed by the FR7-named
  `planr doctor --fix` for confirmed OpenPlanr-owned stale scratch only.
- `planr operate profiles migrate inspect|apply` migrates a legacy operating
  profile to the supported subset with an exact backup and idempotent apply; the
  CLI never suggests a profile it will reject.
- Completion requires on-disk verification of every phase-F artifact and no
  unowned scratch; a successful `run`, a launched advisor, or a temporary file
  does not constitute completion.
- Existing Protocol v1.2/v1.3/v1.4 projects remain readable.

## Release transaction

Release order is `planr-pipeline@0.39.0` → `openplanr@1.22.0` →
`@openplanr/skills@1.24.0` → marketplace ledger and real-runtime canary. Every
repository retains its own branch, CI, PR, tag, package, and rollback boundary.

Only `openplanr@1.22.0` (this repository) and its `planr-pipeline@0.39.0` pin are
prepared by this work item. `@openplanr/skills@1.24.0` (thin workflow
regeneration) and the marketplace ledger and canary are coordinated but not yet
released; the marketplace ledger remains unmerged until the real-runtime canary
passes on each supported runtime. Publish and tag of every participant are gated
on the owner and are not performed here.
