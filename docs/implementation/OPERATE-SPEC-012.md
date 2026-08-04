# OPERATE-SPEC-012 — Operate DevEx overhaul

Release participant: `openplanr@1.25.0`

Contract dependency: `planr-pipeline@0.41.0` / Protocol v1.4.0.

Umbrella spec: `SPEC-007`.

## Scope

Twelve defects found by *using* the Operating Board end to end, not by reading it.
The common root was contract asymmetry: contracts were enforced at record time but
absent from the mandate the agent received, so a well-behaved agent could not know
what would be accepted until it was rejected.

## Required behavior

- Every mandate discloses the response contract that binds it — the JSON schema,
  the allowed proposal types, and the per-role proposal cap — so no rule is
  enforced that was not disclosed.
- `planr operate harness validate` dry-runs a response against that contract at
  zero token cost, and batch validation reports every violation in one pass rather
  than one per round-trip.
- The Chair can propose again: its bounds are reconciled from the route registry
  instead of a hardcoded list disjoint from the action image.
- Citations anchor against v1.4 rules with sibling-component resolution.
- Lease state is visible, and renewal is covered by the recorded lifecycle.
- The public dashboard projection is emitted, so a reviewable cycle is readable by
  the dashboard reader instead of reporting `absent`.
- Non-interactive `operate init` fails honestly instead of exiting 0 with no output.
- `operate report <cycle> --html` renders a self-contained shareable board.

## Ledger

Recorded as `OPERATE-SPEC-012` in `openplanr/marketplace`.
