# ADR-002: Portable Pipeline Package Boundary

## Status

Accepted

## Decision

`planr-pipeline` remains the complete PO, Design, DEV, QA, and delivery product
and becomes the public `planr-pipeline` package. Deterministic workflow
state belongs in its Node engine; runtime adapters own only model/tool dispatch.

OpenPlanr remains the dedicated planning CLI and common setup/router surface.
It consumes the public pipeline API rather than copying pipeline procedures.

Runtime-neutral assets use logical `openplanr://` references. Native adapter
compilers resolve or materialize those references for their runtime. Claude-only
plugin-root references stay inside the Claude adapter.

## Consequences

- The four components retain independent identities and version histories. (As of
  [ADR-013](./ADR-013-monorepo-independent-versions.md) they are packages in one
  repository; independent versioning is unchanged, and the three plugin repos
  survive as read-only mirrors.)
- Pipeline package releases precede CLI and adapter releases.
- The package must ship an explicit files allowlist and npm provenance.
- Existing Claude commands remain supported during the migration window.
