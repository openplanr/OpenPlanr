# OPERATE-SPEC-003 marketplace work item

Umbrella specification: `SPEC-003`  
Release participant: `openplanr-marketplace@1.2.0`

Marketplace owns the draft saga ledger and the resolved
`guidedOperatingBoard` compatibility capability. The existing verified
SPEC-002 Operating Board record remains immutable.

The guided capability was held unavailable during the release transition until
pipeline `0.31.0`, OpenPlanr `1.15.1`, skills `1.17.2`, marketplace `1.2.0`,
exact repository revisions, CI, packages/tags, and runtime canaries reconciled.
OpenPlanr `1.15.1` is the forward fix for the initialization-preview replay
handoff found by the first production canary. The exact-commit replacement
canary passed on Ubuntu, macOS, and Windows with Node 20 and 22. Before
publication each participant may compensate locally; after an npm package is
public, recovery is forward-fix only.
