---
title: "Limit composition fan-in and workspace edges"
status: "accepted"
---

# Limit composition fan-in and workspace edges

## Context

Composition roots wire many modules, and every import is a dependency a reviewer follows.
Unbounded, a root grows until most changes touch it. An import of a private workspace from a
published package resolves inside this repository, where every workspace is linked, and fails
for users, who cannot install it.

## Decision Drivers

- A composition root's imports show what it wires.
- A published package never resolves a private workspace.
- A new edge between workspaces is a deliberate, reviewed change.

## Considered Options

### Option 1: Convention and review

**Pros:**
- No script to maintain.

**Cons:**
- Limits erode one import at a time, and a forbidden import goes unnoticed until an isolated
  install loads it.

### Option 2: Scripted limits and an allowlist of edges

**Pros:**
- A violation fails CI with the file and the count, and every limit is a reviewed literal.

**Cons:**
- The count is a proxy, and a limit has no per-file exceptions.

## Decision

Script the limits and the edges (option 2); `npm run check:boundaries` runs both checks in the
CI quality and compatibility jobs. [`scripts/check-composition-boundaries.mjs`](../../scripts/check-composition-boundaries.mjs)
counts the lines of a module that start with `import`:

- At most 20 in any module under its nine production source roots, skipping `generated/`,
  `vendor/` and declaration files.
- At most 12 in the CLI entry `packages/cli/src/cli/index.ts`, the five CLI command groups, every
  dashboard `.ts` and `.tsx` file, each Operate command registrar (which declares at most 10
  commands) and the seven bounded composition roots.
- A bounded composition root imports only from its facade directory, `node:` built-ins,
  `commander`, `chalk`, `./client-error.js` and `./errors.mjs`; the Operate client
  `packages/cli/src/services/operate/client.ts`, for example, goes through `./client/`.
- The CLI entry imports commands only through `./commands/index.js`, the Operate command entry
  point uses `./registrars/index.js`, the eleven facade directories contain no `export *`, and
  the eight pipeline domain facades under `packages/pipeline/lib/` exist.

[`scripts/check-workspace-boundaries.mjs`](../../scripts/check-workspace-boundaries.mjs)
permits only `@openplanr/protocol` from operate, artifact, design, skill-runtime and the
dashboard and `@openplanr/artifact` from design, and rejects runtime imports of `conformance/`
and of the CLI package `openplanr`. [`scripts/lib/workspace-release-policy.mjs`](../../scripts/lib/workspace-release-policy.mjs)
applies the same edges to `package.json` dependencies, adds the CLI's optional dependency on
`planr-pipeline`, pins each exactly and keeps private workspaces npm-private. Nothing may
import `@openplanr/operate`, so the CLI reaches Operate only through `planr-pipeline` export
subpaths.

To change a limit or an edge, edit it in the pull request that needs it, say why, and update
this record; prefer splitting the module or adding a facade entry. Limits sit beside their
failure messages and the lists `productionSourceRoots`, `boundedCompositionRoots`,
`expectedGroups`, `explicitFacadeRoots` and `pipelineDomains`; edges are `allowedInternalImports`
and `internalDependencies`. The policy file is digested into
`adapters/manifests/ecosystem-assets.json`, so run `npm run generate` and commit that manifest.

## Consequences

### Positive

- Growth goes into named facade directories such as `./client/` rather than into the root.
- The dependency graph in the [architecture guide](../architecture/README.md) is checked, not
  only described.

### Negative

- Only lines that start with `import` count: a multi-line import counts once, and
  `export … from` re-exports are neither counted nor held to the facade.
- Raising a limit raises it for every module in its group.
- The composition check reads the projected `runtime-foundation.mjs`, so it runs only after
  `npm run generate` ([projection model](001-projection-model.md)).
