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

## Shared screen sources

New authored Design Studio boards use an additive envelope format: one canonical
HTML source per screen and variant, with separate viewport references. Protocol
1.16 describes `schemaVersion: "1.1.0"` envelopes with up to 256 sources and 4,096
views; `createSharedArtifactEnvelope()` creates them and `resolveArtifactHtml()`
reads both shared and legacy inline envelopes. The original `createArtifactEnvelope()`
continues to emit the byte-compatible inline format. Encryption and transport byte
budgets are unchanged.

The preview loader prepares only the active selection by default and keeps at most
three live frames. Each frame must authenticate its bridge before becoming ready.
Source, document and bridge failures settle within a deadline and expose a retry;
inactive failures do not block the selected screen. `getFrameDiagnostics()` returns
phase timings without HTML, local paths or bridge capabilities. Portable exports
prepare shared sources once, then bind a distinct generated artifact identity for
each viewport while retaining the opaque frame sandbox.

## Semantic diagrams

`@openplanr/artifact/diagram` validates Protocol 1.6 semantic diagram documents,
routes 39 visual grammars, plans readable multi-panel splits, imports a bounded
Mermaid flowchart subset with an explicit fidelity report, and validates static
SVG accessibility. Canonical fixtures, progressive references, and searchable
script-free galleries are generated under `fixtures/diagram/`,
`references/diagram/`, and `gallery/diagram/`.

`@openplanr/artifact/diagram-editor` exports the shared browser editor and its
host-neutral Mermaid copy panel. Imports preview semantic, presentation and exact
source-text fidelity separately before a new unsaved diagram can adopt the copy.
Exports keep the complete editable bundle, Mermaid copy and SVG snapshot distinct;
uploads never grant repository link, watch or write authority.
Direct company-shell mounts of `mountDiagramSourcePanel()` must also load
`planr-pipeline/diagram-editor.css`, the published copy of this stylesheet. The controller applies an isolated
`planr-diagram-source-panel` scope outside the full editor, so the shared controls
and responsive light/dark theme do not change host-page typography or layout.

Layered graph layouts wrap long layer sequences, including large strongly
connected components, into bands along the cross axis once the flow axis
exceeds 4,096 units, balancing the scene toward a square. Any scene wider or
taller than `MAX_DIAGRAM_SCENE_EXTENT` (16,384 units) fails with
`E_DIAGRAM_RESOURCE_BUDGET_EXCEEDED` instead of emitting an artifact that
viewers and the rasterizer reject.

Run `npm run generate:diagram` after changing a diagram definition and
`npm run check:diagram && npm test` before integration.

## Native encrypted diagram reviews

The `diagram/review-bundle` builder projects verified manifests and authored
bundles into a whitelisted review scene. Geometry and connections remain intact;
source bytes, local paths and private provenance are excluded. The portable
`diagram-shared-review` shell mounts the native canvas or the existing read-only
editor after the packaged Inter font is ready.

`diagram/share` owns private local custody and explicit publication. One diagram
has one stable `/diagram/<id>` URL with a separate reviewer token. Reviewers can
comment on the current published revision, inspect earlier revisions, and export
SVG, PNG and feedback. Feedback synchronization writes a local review ledger;
it does not change the diagram or execute comments.

The artifact package owns the reusable encrypted workspace and custody
primitives. Design sharing remains a compatibility façade with its original
routes, storage and cryptographic domain. Diagram workspaces use a separate
domain and `/api/v1/diagram-workspaces` routes.
