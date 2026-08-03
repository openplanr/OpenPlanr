# OPERATE-SPEC-005 marketplace work item

Umbrella specification: `SPEC-005`  
Release participant: `openplanr-marketplace@1.5.0`

Marketplace owns the coordinated saga ledger and the revised
`agenticOperatingBoard` compatibility capability for the field-fix release of
the Operating Board execution train. The verified SPEC-002, SPEC-003, and
SPEC-004 records remain immutable.

The release records pipeline `0.34.0` (mission record actions naming the
generated lens agents; both protocol registries modernized to 1.3.0), OpenPlanr
`1.18.0` (mission dispatch made real end to end: mission packets with bounded
read-only grants and citation-bearing v1.3 responses, pack input budgets
enforced fail-closed at field-incident scale, the mandatory review gate
rendered for humans, executable interaction continuations, machine-local state
bound to board identity, typed provider-bootstrap errors, real host-runtime
detection, the onboarding questionnaire diet, and surfaced adapter session
leases), and skills `1.20.0` (the mission-branch operate skill mirrored and
validated against pipeline 0.34.0).

Because the pipeline adapter registry now itself declares protocol `1.3.0`,
this release advances the resolved manifest's `protocol.current` from `1.2.0`
to `1.3.0`. Advisor dispatch capability per adapter is unchanged from the
SPEC-004 classification: native read-only dispatch on hosts with parallel
subagents; structured-provider fallback elsewhere. Cadence-triggered runs
remain review-only: nothing in this capability accepts a finding, applies a
route, or chains into PLAN or SHIP.

Before publication each participant may compensate locally; after an npm
package is public, recovery is forward-fix only.
