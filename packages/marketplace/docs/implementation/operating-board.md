# Operating Board downstream work item

- **Operation:** `OPERATE-SPEC-002`
- **Umbrella specification:** `openplanr/planr-pipeline` —
  `.planr/specs/SPEC-002-openplanr-operating-board/SPEC-002-openplanr-operating-board.md`
- **Repository:** `openplanr/marketplace`
- **Target:** marketplace metadata 1.1.0

## Repository-only scope

- Resolve Protocol, component, adapter, runtime, and `operatingBoard`
  compatibility from canonical read-only workspace inputs.
- Advertise `planr operate` only when Protocol v1.2, pipeline 0.30.0,
  OpenPlanr 1.14.0, skills 1.16.0, and all three certified adapter entrypoints
  are present.
- Add the strict coordinated-saga ledger schema, example, validator, and
  read-only CI workflow. The marketplace draft PR is the audit ledger; resume
  reconciles authoritative PR, commit, tag, CI, npm tarball, and manifest state.
- Bind approval and promotion to the operation digest, umbrella/repo-local spec
  IDs, repository-relative implementation work items, exact target branches,
  and exact next safe action. After publication, permit forward-fix recovery
  only.
- Keep adapter support as a declared capability until the globally reconciled
  release is verified. Per-adapter `available` flags must remain false whenever
  the global capability is unavailable.
- Require immutable canary evidence for the packed CLI, Protocol v1.2,
  event replay/corruption handling, security boundaries, and outcome
  reconciliation. The read-only canary workflow produces evidence artifacts;
  it never edits the ledger or marks an operation verified.
- Generate the README compatibility tables and capability status from the same
  resolved manifest.

This work item may read upstream package, registry, CLI-command, and skill
inputs. It must not write `planr-pipeline`, `OpenPlanr`, `skills`, or any other
sibling repository.

## Two-step marketplace closeout

The marketplace ledger PR remains open and advertises the capability as
`unavailable` while upstream releases and canaries run. Before merging it, the
ledger records every upstream participant's immutable commit, merged PR, tag,
CI result, npm integrity/tarball digest where applicable, and the five canonical
canary records. A local version bump or a passing canary is not sufficient to
open availability.

After the upstream participants are verified:

1. Merge the ledger PR without changing the generated capability from
   `unavailable`.
2. Tag marketplace `1.1.0` from that merged revision and verify the tag/archive
   digest and required checks.
3. Prepare a follow-up finalization update that records the merged ledger PR,
   marketplace tag, participant digests, and authoritative live-state
   reconciliation. The append-only history must record
   `reconciliation.recorded` before `operation.verified`.
4. Regenerate the manifest from the now-valid verified operation and reconcile
   the candidate manifest as `available`.
5. Merge the finalization update only when `npm run check`, `npm test`,
   `npm pack --dry-run`, and the reconciliation result are clean.

The follow-up update is required because a PR cannot attest to its own future
merge and tag. Marketplace availability opens only after that update lands; the
marketplace tag remains the versioned release and no second package publish is
required. Any mismatch with live PR, commit, tag, CI, npm, canary, or manifest
state keeps the capability unavailable.

## Verification

```bash
npm run check
npm test
npm pack --dry-run
```

Tests cover exact component alignment, truthful capability gating, strict
ledger order and repositories, repo-local work-item binding, canary evidence,
completion prerequisites, and documentation drift.

## Rollback boundary

Before marketplace merge, close or revert only this repository’s draft ledger
PR and leave the previous manifest published. If any upstream package is already
published, withhold marketplace availability and use the coordinated saga’s
forward-fix path; never claim global rollback or attempt package unpublication
from this repository.
