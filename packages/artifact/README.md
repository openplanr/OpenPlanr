# `@openplanr/artifact`

Canonical MIT workspace package for artifact envelopes, secure bundling, review,
sharing, live rooms, and browser-shell support. Generic loopback, path,
escaping, contrast, and feedback primitives live here so the dependency remains
one-way: design may use artifact, but artifact never imports design.

Protocol schemas, registries, validation, canonical errors, and JSON contracts
come from `@openplanr/protocol`. Public `planr-pipeline` compatibility files are
generated as ordinary files without symlinks.

This workspace is npm-private; its source remains part of the public MIT monorepo.
Its required runtime is distributed through the public CLI and pipeline packages.

## Semantic diagrams

`@openplanr/artifact/diagram` validates Protocol 1.6 semantic diagram documents,
routes 39 visual grammars, plans readable multi-panel splits, imports a bounded
Mermaid flowchart subset with an explicit fidelity report, and validates static
SVG accessibility. Canonical fixtures, progressive references, and searchable
script-free galleries are generated under `fixtures/diagram/`,
`references/diagram/`, and `gallery/diagram/`.

Layered graph layouts wrap long layer sequences, including large strongly
connected components, into bands along the cross axis once the flow axis
exceeds 4,096 units, balancing the scene toward a square. Any scene wider or
taller than `MAX_DIAGRAM_SCENE_EXTENT` (16,384 units) fails with
`E_DIAGRAM_RESOURCE_BUDGET_EXCEEDED` instead of emitting an artifact that
viewers and the rasterizer reject.

Run `npm run generate:diagram` after changing a diagram definition and
`npm run check:diagram && npm test` before integration.
