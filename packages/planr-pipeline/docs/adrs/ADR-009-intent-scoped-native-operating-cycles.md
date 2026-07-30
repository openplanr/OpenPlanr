# ADR-009: Intent-scoped native Operating Board cycles

## Status

Accepted

## Context

The guided interaction contract correctly prevents a questionnaire answer or a
preview from authorizing unrelated mutations. Applied literally to every
machine lifecycle call, however, it turns one Operating Board cycle into a
sequence of user-operated commands:

```text
preview → run → prepare → record each lens → finalize
        → resume → prepare Chair → record → finalize → review
```

That is not a meaningful set of independent product decisions. The adapter
calls are digest-bound, resumable implementation details of the one reversible
cycle the user asked the coding runtime to run. Requiring a new approval for
each call prevents certified runtimes from reaching the advisory lenses and
leaves cycles blocked without findings.

Codex also cannot truthfully claim hard tool isolation. It can, however, consume
the sanitized, immutable, role-filtered packs produced by OpenPlanr inside the
user-approved coding harness. Calling that mode `enforced` would overstate the
security guarantee.

## Decision

Certified adapters declare one Operating Board advisor mode:

- `native-isolated`: native dispatch with host-enforced empty-tool isolation;
- `native-bounded`: native dispatch in the active, user-authorized harness,
  restricted by the adapter contract to OpenPlanr's sanitized digest-bound
  role packs;
- `structured-provider`: OpenPlanr invokes a separately configured provider
  under its provider-consent policy.

An explicit user request to run one Operating Board cycle authorizes the
reversible local continuation steps needed to reach `reviewable` for that
cycle. The runtime previews first, then may perform cycle start, adapter
prepare, advisor record/finalize, Chair record/finalize, and read-only report
rendering without asking the user to paste or re-run commands.

This request-scoped authority does not include:

- configuring or consenting to an external provider;
- accepting a finding;
- applying or rolling back a route;
- creating planning artifacts unless separately selected;
- PLAN or SHIP;
- deployment, publication, spending, customer contact, or another cycle.

If no eligible evidence remains for a lens, that lens is reported as
`not_evaluated`. A secret-bearing evidence item is quarantined and omitted; it
blocks the cycle only when required evidence can no longer be satisfied.

## Consequences

- Claude Code and Codex can complete a useful cycle inside their native agentic
  harness instead of acting as passive CLI wrappers.
- Codex's security claim remains accurate: runtime tool isolation is advisory,
  while the evidence pack, digest, output validation, and persisted state
  boundaries are enforced by OpenPlanr.
- Cursor remains on the structured-provider/handoff path until it exposes a
  certified native lifecycle.
- Route, planning, delivery, and external-effect gates remain unchanged.
- Cycle and per-lens Markdown/JSON reports become the primary review surface;
  the visual dashboard is an optional projection.
