# ADR-013: One monorepo, independent package versions

## Status

Accepted (2026-08-02). Amends the *context* of [ADR-001](./ADR-001-protocol-ownership.md);
its ownership decision is unchanged.

## Context

OpenPlanr shipped as four repositories: `openplanr/OpenPlanr` (the `openplanr` CLI),
`openplanr/planr-pipeline` (the engine, protocol schemas and conformance suite),
`openplanr/skills` (assistant routing) and `openplanr/marketplace` (Claude Code plugin
distribution).

Every cross-package version pin was maintained by hand across those boundaries — the
marketplace manifest, `ecosystem.json`, the compatibility matrix, `input/tech/stack.md`, the
protocol README, the adapter registry. Nothing could validate them together, because nothing
could see them together. The observable result was drift: the marketplace pin sat multiple
minors behind, and `SKILL.md` inlined artifact frontmatter hand-copied from
`schemas/v1.0.0/` with no mechanism that could ever compare the two.

A second, quieter cost: `openplanr/skills` had no CI at all, and the vendored Cursor agent
templates in the CLI had drifted 1.5x-6x from the canonical agents in the engine without
anything noticing.

## Decision

**One repository, four packages, independent versions.**

`openplanr/OpenPlanr` becomes the monorepo root — reused, not replaced — with npm workspaces at
`packages/OpenPlanr`, `packages/planr-pipeline`, `packages/skills` and `packages/marketplace`.

Versions stay **independent**, managed by changesets and released atomically. This is a
deliberate departure from the original "one semver" framing of the work item.

### Why independent, not one semver

One shared version number would force a major bump of `openplanr` (1.21.2) for a
pipeline-only change, and vice versa. Consumers pinned to `^1.x` or `^0.38.x` would silently
stop receiving updates — no error, no warning, just a package that quietly stops moving. The
drift being solved was never *"the version numbers differ"*; it was *"the pins are maintained
by hand"*. Generating every pin from the four `package.json` files solves that completely,
and does so without breaking a single existing consumer.

### What ADR-001 keeps

`packages/planr-pipeline` remains the canonical owner of `schemas/v1.0.0/`, `docs/protocol/`
and `conformance/`. Only ADR-001's framing of these surfaces as separate *repositories*
changes; they are now separate *packages*. Schema-breaking changes still start in the engine.

### Directory names are frozen

`workspace-discovery.mjs`, `doctor.mjs` and `ecosystem-conformance.mjs` resolve packages by
directory name, and Linux CI is case-sensitive — `packages/OpenPlanr` keeps its exact casing.
Renaming any package directory means rewriting those resolvers and their fixtures in the same
commit. Do not rename them for tidiness.

## Consequences

**Enabled.** Cross-package invariants became checkable for the first time, because the two
sides finally sit in one tree:

- every version pin is generated (`scripts/sync-ecosystem.mjs`, with a `--check` CI gate);
- `SKILL.md`'s inlined frontmatter is validated against the canonical schemas in both
  directions (`scripts/check-cross-refs.mjs`);
- vendored-agent divergence is frozen at its current, accepted baseline and fails only on new
  drift (`scripts/check-agent-divergence.mjs`);
- `skills` has CI for the first time.

**Preserved.** Both published package names, both version lines, all bin entries and both
`files[]` allowlists are unchanged, so nothing anyone has installed breaks. The three plugin
repositories continue to exist permanently as read-only mirrors, because
`/plugin marketplace add` resolves `.claude-plugin/marketplace.json` at a *repository root*
and only one root can hold it.

**Accepted costs.**

- The three inbound repositories' commit SHAs were rewritten by
  `git filter-repo --to-subdirectory-filter` so historical paths are correct. The originals
  remain reachable forever via the `pre-monorepo` tag on each origin. The host was **not**
  filtered: its SHA stability is provenance for the published package, its docs links and its
  CHANGELOG. See `docs/monorepo-provenance.md` for why the asymmetry is deliberate.
- The bare `vX.Y.Z` tag namespace is retired. Future tags are changesets-format
  (`openplanr@1.22.0`, `planr-pipeline@0.39.0`) and cannot collide; the 132 inbound tags were
  renamed under `legacy-*` prefixes, none matching `v*`.
- Mirror freshness is now a thing that can break. It is gated in CI rather than trusted.
