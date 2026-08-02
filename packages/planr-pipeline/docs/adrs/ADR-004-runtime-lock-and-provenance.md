# ADR-004: Runtime Lock and Artifact Provenance

## Status

Accepted

## Decision

Projects commit `.planr/runtime-lock.json` with exact component and adapter
versions plus the resolved compatibility-manifest digest. Machine-specific
paths and installation state remain under the user's Planr home.

OpenPlanr and planr-pipeline append artifact operations to
`.planr/provenance.jsonl`. Provenance is a sidecar contract so existing v1.0
SPEC, story, and task frontmatter remains valid without migration.

## Consequences

- Teammates can reproduce adapter behavior across machines.
- The intentional overlap between the two planning engines is auditable.
- Provenance write failures are visible and recoverable; history is never
  silently fabricated.
- Protocol v1.1 adds optional ecosystem contracts while retaining v1.0 artifact
  readers and schemas unchanged.
