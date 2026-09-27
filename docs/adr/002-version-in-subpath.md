---
title: "Version public APIs in the export subpath"
status: "accepted"
---

# Version public APIs in the export subpath

## Context

`planr-pipeline` publishes the Operate runtime as 25 export subpaths, each ending in `-v2` and
mapped to one module and its declarations in `packages/pipeline/package.json`;
`./operate/runtime-v2`, for example, resolves to `lib/operate/runtime-foundation.mjs`. The
identifiers inside repeat a version: most exported function names under `packages/operate/lib`
end in `V2`, and thirteen end in `V1`. The suffix means two things. `V2` restates the Operate 2.0
version that the subpaths already carry, while a `V1` name such as
`buildOperatingPlanningProposalV1` in `planning-bridge-v2.mjs` follows the `schemaVersion` of the
record it builds. The rename below covers `packages/operate/lib`, whose modules ship under the
`planr-pipeline/operate/*` subpaths.

## Decision Drivers

- An importer finds the version in one place.
- A breaking change to one module must not rename call sites of functions that did not change.
- A published subpath cannot disappear silently.
- Persisted records already carry their own `schemaVersion`.

## Considered Options

### Option 1: Version suffix on every identifier

**Pros:**
- The version is visible at every call site.
- Two versions of a module import into one file without aliases.

**Cons:**
- The version is stated twice, and the two statements can disagree.
- A new version renames every call site, including those of unchanged functions.

### Option 2: Version in the export subpath only

**Pros:**
- Node resolves the version from the specifier, and the packed-surface baseline pins it.
- Files behind a subpath can move or split without breaking importers.

**Cons:**
- Importing two versions of a module into one file needs import aliases.

## Decision

Version public APIs by export subpath (option 2):

- New code adds no version suffix to identifiers.
- The existing `V2` and `V1` suffixes are removed in one mechanical rename that changes names
  only and updates every importer in the same change.
- A breaking change to a module ships as a new subpath beside the old one, such as
  `./operate/runtime-v3`. The old subpath stays until a breaking `planr-pipeline` release
  removes it together with its entry in `conformance/packed-surface-baseline.json`.
- A persisted record keeps its `schemaVersion` field, which versions data, not code.

The export map declares no `./lib/` subpath, so a deep specifier such as
`planr-pipeline/lib/operate/…` does not resolve.
[`scripts/check-workspace-boundaries.mjs`](../../scripts/check-workspace-boundaries.mjs) lets no
workspace import `@openplanr/operate`, so outside its own workspace Operate is reachable only
through these subpaths, and
[`scripts/verify-packed-workspace.mjs`](../../scripts/verify-packed-workspace.mjs) fails when a
subpath listed in the baseline is missing from the packed package. No script rejects a
suffixed identifier; review does.

## Consequences

### Positive

- The specifier carries the version, and names stay the same across versions.
- A new version changes the specifiers of the modules that change, not every identifier.
- The [Operate runtime reference](../../packages/pipeline/docs/protocol/operate-runtime-v2.md#public-package-surface)
  lists the complete versioned surface.

### Negative

- The rename changes exported names of published subpaths: it breaks importers outside this
  repository, and the CLI moves in the same release because it pins `planr-pipeline` exactly.
- Code that uses two versions of one module aliases its imports.
- Function names in stack traces no longer show a version.
