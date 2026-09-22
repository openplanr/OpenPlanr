# Repository maintenance and generated distributions

Status: accepted. Date: 2026-09-22.

## Context

Consolidation brought the CLI, pipeline, Protocol, skills, and local studios into
one public repository while retaining package identities and public Git ancestry.
The hosted service remains separately owned. Migration inventories proved that
source and release assets survived the move; they are historical evidence rather
than a continuing product contract.

## Decision

Keep one canonical owner for each capability. Remove retired host trees, unused
snapshots, and one-time consolidation machinery after checking live consumers.
Retain migration evidence through ordinary Git history so an earlier revision can
be inspected or restored without keeping old copies in the active source tree.
This does not retire supported schemas, package exports, runtime compatibility
fixtures, licenses, attribution, or release history.

The root contribution guide, security policy, and Code of Conduct apply to all
packages. Package-level documents link to those existing policies.

Generated distribution bytes belong in build output. Protocol schemas and registries,
domain runtimes and templates, and skill runtime bundles are projected from their
canonical owners during `npm run generate`. Their distribution copies are ignored
by Git; canonical schemas, published exports, and projection manifests stay tracked.
This is the reviewed migration from the previous checked-in projection policy.

Run `npm ci`, `npm run generate`, and `npm run build` on a fresh checkout before
running package consumers. Check mode verifies existing output and does not
bootstrap missing distributions. Each packed package must work without sibling
repositories or unpublished workspace dependencies. Package and schema versions
remain independent.

Pipeline publication checks each generated path against the existing projection
manifests and regenerated canonical owners, then verifies those paths and hashes
inside the final archive. Unlisted ignored files are rejected. This retains an
explicit package boundary without requiring duplicate runtime bytes in Git.

## Evidence and checks

A retained artifact or gate should identify a current consumer and the failure it
prevents. Imports, package exports, generators, developer commands, fixtures, and
CI are all consumers. The absence of a CI call alone does not make a command dead.

Use focused behavioral checks, package boundaries, generated-output checks, and
isolated package consumption to test the current product. Do not keep duplicate
inventories solely to prove that retired files still exist. Platform-specific
browser baselines stay with their active screenshot comparisons; historical
unscoped screenshots remain available in Git.

## Consequences

Contributors review canonical changes and generated manifests. Historical
investigations use Git instead of live migration scaffolding. Public package
installation contracts and hosted service ownership remain unchanged.
