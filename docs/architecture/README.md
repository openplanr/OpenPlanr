# OpenPlanr architecture

The public MIT monorepo separates canonical domains from self-contained CLI and pipeline compatibility packages. Protocol is also independently publishable. Other workspaces are npm-private MIT source; their implementations can be projected into public packages at generation time. Public tarballs do not resolve unpublished workspaces at runtime.

```text
packages/operate       -> packages/protocol
packages/artifact      -> packages/protocol
packages/design        -> packages/artifact + packages/protocol
packages/pipeline      -> self-contained projections of protocol, operate, artifact, and design
packages/skill-runtime -> packages/protocol + declarative contribution manifests
apps/dashboard         -> browser-safe packages/protocol contracts
packages/cli           -> exact optional planr-pipeline dependency
```

Binding constraints are executable in `scripts/check-workspace-boundaries.mjs`: runtime code cannot import conformance, internal packages cannot depend on the CLI, Operate cannot import runtime implementations, artifact cannot depend back on design, and no public package may require a private package or local source path.

Composition boundaries use explicit domain facades rather than leaf-import walls. The CLI root composes five named command groups, dashboard composition roots consume explicit runtime/route registries, and pipeline internals expose eight phase/domain facades. `scripts/check-composition-boundaries.mjs` enforces bounded fan-in and rejects wildcard barrels at these boundaries; cohesive leaf modules remain free to import the dependencies needed by their own implementation.

## Ownership depth

- `skills/planr-*` contains canonical skill sources; generated host assets live under `adapters/`.
- `agents/{po,dev,qa,post-build}/` contains phase- and task-kind-specific canonical role definitions.
- `packages/protocol/` owns schemas, registries, catalogs, browser-safe contracts, canonical JSON, validation, and shared typed errors.
- `packages/operate/`, `packages/artifact/`, and `packages/design/` own their runtimes in dependency order.
- `packages/pipeline/lib/{po,dev,ship,roles,guided,investigate,release,state}/` provides explicit internal domain facades over preserved public modules. `lib/domain-ownership.json` is the machine-readable map.
- `apps/dashboard/` owns browser code; the CLI contains only its digest-verified compiled copy and Node-side readers.
- `conformance/` evaluates public contracts without being imported by runtime code.
- `evaluation/`, `templates/`, and `examples/` are root-level entry points for evaluation custody, shared authoring conventions, and protocol usage.

## Skill source and generation workflow

- Edit task-specific behavior only in `skills/planr-*/SKILL.md`; edit reusable policy only in a declared file under `skills/shared/`.
- Run `npm run generate` from the workspace root. `scripts/skills/generate-v18.mjs` is the sole host-package generator; canonical skills stay under `skills/` and ignored installable packages are emitted to `dist/plugins/`.
- Treat `packages/pipeline/registry/generated-skill-assets.json` as package custody, not an authoring surface. The guided-adapter generator verifies that inventory and writes no prompt files.
- Run `npm run check:generated` before review. It rejects stale projections, duplicate writers, unsafe or cyclic shared includes, digest drift, and undeclared package assets.
- Closed registries containing historical prompt snapshots remain compatibility evidence. They are readable but do not override the canonical root source.

The v0.1 architecture is deliberately additive around compatibility. Later 0.x milestones may physically collapse additional compatibility projections once package consumers have migrated.

## Distribution and service boundary

This repository owns the MIT-licensed portable product. The separate hosted
service owns tenant storage, authorization, billing, enterprise administration,
provider credentials, and deployment operations. Public clients and Protocol
contracts may describe those capabilities, but every hosted resource permission
is enforced server-side. See the [commercial boundary](../../COMMERCIAL.md).
