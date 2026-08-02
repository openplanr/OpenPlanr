# ADR-012: Board-sync identity fields on Protocol v1.0 artifact frontmatter

- Status: Accepted
- Date: 2026-08-02
- Protocol: 1.0.0 (additive amendment)
- Relates to: ADR-001 (protocol ownership), the OpenPlanr CLI Linear
  integration (`linearId` write-back precedent)

## Context

The kanbanos hosted board is a planr sync target in the same family as the
Linear integration: the CLI pushes SPEC, User Story, and Task artifacts to the
board and must be able to correlate each markdown file with its hosted entity
on subsequent syncs. The Linear integration solved this by writing an id back
into artifact frontmatter after the first successful push. kanbanos needs the
same identity write-back plus a content digest so the sync tool can detect
drift between the file and the board without re-reading the remote entity.

The v1.0.0 artifact schemas (`spec.schema.json`, `story.schema.json`,
`task.schema.json`) declare `additionalProperties: false`. Any artifact
carrying sync identity today fails `--validate-schema` and the `tests/schema`
gate. The protocol therefore has to name these fields explicitly.

Two mechanisms were considered:

1. **Amend the v1.0.0 artifact schemas with optional fields.** Existing files
   stay valid; the new fields are validated only when present; unknown fields
   are still rejected.
2. **A new schema version directory with dual-version resolution.** Rejected:
   the conformance runner resolves artifact schemas from a single hardcoded
   `schemas/v1.0.0/` directory (`conformance/runner.mjs`), no multi-version
   artifact resolution exists anywhere in the engine, and the protocol pinning
   rule reserves `schemaVersion` bumps for **breaking** changes. The additive
   v1.1–v1.4 namespaces are precedent for new artifact *types*, not for
   parallel versions of the spec/story/task frontmatter.

## Decision

Mechanism 1. Two OPTIONAL fields are added to the v1.0.0 SPEC, User Story, and
Task frontmatter schemas — all three artifact types are sync targets:

- `kanbanosId` — the hosted board's opaque entity id. URL-safe token,
  `^[A-Za-z0-9_-]{8,128}$`, `minLength: 8`. The protocol ascribes no structure
  to it beyond the pattern; the board owns its id format.
- `contentHash` — digest of the artifact content at the last successful sync.
  Reuses the existing repository precedent exactly:
  `^sha256:[a-f0-9]{64}$`, the same shape as
  `operating-evidence-index-item@1.3.0`'s `contentHash`.

`schemaVersion` stays `"1.0.0"`: an artifact without the fields and an
artifact with them are both valid v1.0.0 artifacts, and every existing reader
keeps working unchanged.

### Writer contract

Only sync tooling writes these fields, only after a successful push, exactly
as the Linear integration writes `linearId`. Humans and planning agents never
author or edit them by hand; the specification-agent never emits them during
decomposition; a hand-edited value is a sync bug, not an authoring surface.
Both fields are absent until the artifact is first pushed.

### No rank field — governance rule

There is deliberately NO rank / ordering / position field, and none may be
added later under this ADR. Board ordering is board-sovereign presentation
state: rank churns on every drag, would turn every board interaction into a
repository diff, and would invite merge conflicts on lines no human authored.
Rank never enters files. The board keeps ordering on its side keyed by
`kanbanosId`. The schemas' `additionalProperties: false` enforces this — a
`rank`, `kanbanosRank`, or similar field fails validation, and the
`tests/schema/board-sync-identity.test.mjs` suite pins that rejection.

## Consequences

- Artifacts written back by the kanbanos sync tool pass
  `node conformance/runner.mjs --validate-schema` and the `tests/schema` gate.
- Existing artifacts remain valid byte-for-byte; no migration, no
  `schemaVersion` bump, no reader change on any runtime.
- Unknown sync fields (including any rank variant) are still rejected by
  `additionalProperties: false`.
- A malformed `contentHash` (wrong algorithm, uppercase hex, truncated digest)
  or a non-opaque `kanbanosId` fails validation when present.
- Future sync targets that need identity write-back must go through the same
  ADR process; the two fields here are kanbanos-specific by name, mirroring
  the tool-specific `linearId` precedent rather than a generic sync map.
