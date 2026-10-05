---
title: "Project the domain workspaces into planr-pipeline"
status: "accepted"
---

# Project the domain workspaces into planr-pipeline

## Context

Operate, artifact and design are developed as the workspaces `packages/operate`,
`packages/artifact` and `packages/design`, each with its own dependencies and tests. Users never
install them: the `openplanr` CLI pins `planr-pipeline` exactly and runs all three from it, Operate
through its export subpaths and artifact and design from its files.

## Decision Drivers

- One published carrier: `planr-pipeline` depends on no other package from this repository.
- Offline runtime: the installed `openplanr` and `planr-pipeline` are the complete runtime and
  work [without network access](../../packages/cli/docs/CROSS_RUNTIME_SETUP.md#offline-remote-and-ssh-use).
- Byte custody: every published byte is tracked in Git or listed with a reviewed SHA-256.

## Considered Options

### Option 1: Publish each domain and depend on it

**Pros:**
- A conventional npm graph: no generator, and imports stay as written.

**Cons:**
- Three more packages to version, pin, attest and release in order.
- Each domain's internal module layout becomes a public contract of its own.

### Option 2: Project the sources into planr-pipeline

**Pros:**
- One package carries all three domains, verified byte for byte from source to archive.

**Cons:**
- A generation step, a textual rewrite, and two copies of each domain in a working tree.

## Decision

Project the sources (option 2). `npm run generate` runs
[`scripts/domains/project-domains.mjs`](../../scripts/domains/project-domains.mjs) as step 9 of
the 13 in [`scripts/generate-all.mjs`](../../scripts/generate-all.mjs), after the steps that
project Protocol, compile TypeScript and build the bundles it copies. It copies each root in
`DOMAIN_PROJECTIONS` into `packages/pipeline`, compiled output in place of `.mts` sources, and
changes only quoted `@openplanr/protocol…` and `@openplanr/artifact…` specifiers in script and
declaration files, which become paths inside the package; any other workspace specifier stops
generation. Each copy's source, target, SHA-256 and mode are recorded in
`packages/pipeline/lib/generated/domain-projections/{operate,artifact,design}.json`.
`npm run check:generated` fails on byte, mode, stale-file or manifest drift, and
[`scripts/prepare-publication.mjs`](../../scripts/prepare-publication.mjs) rejects a packed file
that is neither tracked nor listed with a matching digest. Contributors follow four rules:

- Edit the source under `packages/{operate,artifact,design}`, never the copy in
  `packages/pipeline`; `check:generated` reports such an edit and the next generation reverts it.
- Commit changed projection manifests with the source; CI regenerates and fails on any diff.
- Import another workspace only as `@openplanr/protocol` or `@openplanr/artifact`, with a subpath
  where needed; a new Protocol subpath needs an entry in `PROTOCOL_TARGETS`.
- Keep workspace package names out of type casts and string literals bundled into `templates/`.

## Consequences

### Positive

- Every projected byte has a reviewed digest, from the source tree to the published archive.
- The copies keep their modules and declarations, so the pipeline can publish them as
  [versioned export subpaths](002-version-in-subpath.md).

### Negative

- Copies are ignored by Git ([repository maintenance](../architecture/repository-maintenance.md)),
  so a fresh checkout runs `npm run generate` first; until then `npm run check:boundaries` stops
  with `ENOENT` on `packages/pipeline/lib/operate/runtime-foundation.mjs`.
- The rewrite is textual. A type cast or string literal naming a workspace package inside a
  `templates/` bundle, which the artifact shell custody manifest declares byte-for-byte, is
  rewritten too. `check:generated` still passes, since the projection manifest records the
  rewritten bytes; only the pipeline shell-rendering test and the doctor check
  `artifact.generated-assets` report the mismatch.
- `planr-pipeline` must itself declare every third-party package the projected code imports.
- Each domain exists twice after generation, and CLI stack traces point at the pipeline copy.
