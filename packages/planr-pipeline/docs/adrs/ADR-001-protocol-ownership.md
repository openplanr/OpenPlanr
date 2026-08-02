# ADR-001: Protocol Schema Ownership

## Status

Accepted

## Context

OpenPlanr spans multiple repositories:

- `openplanr/OpenPlanr` owns the planning CLI and artifact authoring surface.
- `openplanr/planr-pipeline` owns the complete PO–Design–DEV engine, runtime-neutral contracts, native Claude adapter, local design/dashboard tooling, and conformance suite.
- `openplanr/skills` owns assistant routing instructions.
- `openplanr/marketplace` owns Claude Code plugin distribution metadata.

All of these surfaces depend on the OpenPlanr Protocol artifact contract. Before this ADR, docs pointed at more than one canonical schema location, creating drift risk.

## Decision

For the current cleanup cycle, `planr-pipeline` owns the canonical protocol schemas and protocol docs.

Canonical source:

- `schemas/v1.0.0/`
- `docs/protocol/`
- `conformance/`

Downstream mirrors:

- OpenPlanr CLI schema reference docs
- skill routing docs
- marketplace README and install metadata
- generated Cursor and Codex rule files

## Consequences

- Schema-breaking changes must start in `planr-pipeline`.
- OpenPlanr CLI and skill docs may mirror the schema, but they must not claim independent canonical ownership.
- Version and compatibility docs must be checked against `package.json`, `.claude-plugin/plugin.json`, and `schemas/v1.0.0/`.
- A future dedicated protocol package or repo remains possible, but it is intentionally out of scope for the first stabilization release.

## Verification

Wave 1 stabilization adds:

- `npm run doctor:versions`
- markdown contract tests
- active docs that point back to `schemas/v1.0.0/`
