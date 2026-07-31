# OPERATE-SPEC-004 marketplace work item

Umbrella specification: `SPEC-004`  
Release participant: `openplanr-marketplace@1.4.0`

Marketplace owns the coordinated saga ledger and the resolved
`agenticOperatingBoard` compatibility capability for the Protocol v1.3
agentic-execution release. The verified SPEC-002 and SPEC-003 records
remain immutable.

The release records pipeline `0.33.1` (v1.3 additive schemas, mission-packet
and citation contracts, generated lens agents), OpenPlanr `1.17.0` (the v1.3
engine: `.state/` storage migration with crash-safe reconciliation, evidence
index and digest-bound mission packets, bounded native advisor dispatch,
citation resolution as the audit mechanism, quick-task routes, offline
decision briefs, cadence with the never-acts guarantee, doctor v1.3
diagnostics), and skills `1.19.0` (the re-mirrored operate skill validated
byte-for-byte against pipeline 0.33.1).

Advisor dispatch capability per adapter: native read-only dispatch on hosts
with parallel subagents; structured-provider fallback elsewhere. Cadence-
triggered runs remain review-only: nothing in this capability accepts a
finding, applies a route, or chains into PLAN or SHIP.

Before publication each participant may compensate locally; after an npm
package is public, recovery is forward-fix only.
