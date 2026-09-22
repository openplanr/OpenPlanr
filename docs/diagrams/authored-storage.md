# Saving and rendering authored diagrams

An authored diagram stores meaning and placement together in one canonical file:
`diagrams/{slug}/{slug}.planr-diagram-bundle.json`. A successful save confirms the
complete bundle independently of rendering. Blank drafts and valid large diagrams
can be saved even when a visual export needs more content or a smaller view.

The package APIs are the foundation for editor and local adapters. They do not add
a browser editor, hosted storage, Mermaid conversion, or live collaboration.

## Package boundaries

| Import | Consumer | Behavior |
| --- | --- | --- |
| `planr-pipeline/diagram-authoring` | Browser, Worker, Node | Validate and preview edits; resolve the authored scene; render SVG; preview selected layout and route reset |
| `planr-pipeline/diagram-authoring-store` | Local Node adapter | Read, initialize, preview, commit and recover a canonical bundle; inspect history and legacy migration |
| `planr-pipeline/diagram-authoring-export` | Local Node adapter | Export and verify an immutable bundle snapshot using the packaged offline rasterizer |

## Save and recover

```js
import { createDiagramAuthoringStore } from 'planr-pipeline/diagram-authoring-store';

const store = createDiagramAuthoringStore({ root: workspaceRoot, slug: bundle.diagramId });
const initialized = await store.initialize(bundle, { transactionId: 'create-checkout' });
const preview = await store.preview(transaction);
const result = preview.ok ? await store.commit(transaction) : preview;
```

Initialize only in response to an explicit create or adoption action. Commit uses
the transaction's exact base and checks current bytes again under the diagram
lock. Repeating the same transaction returns its original saved result; reusing
its identifier for different content fails. Operational errors carry a stable
`E_DIAGRAM_STORE_*` code. A stale writer must keep its draft and inspect the current
bundle before constructing another edit.

Only `status: 'saved'` acknowledges a completed write. If the result is `unknown`,
call `store.recover` with its transaction identity, then read again. Do not label
pending work Saved or regenerate it over the existing source. An unknown external
change is retained for inspection. Immutable snapshots and transaction metadata
support recovery and history; they are not alternate editable documents.

The configured root must exist. Observed symlink paths, linked files, unowned
collisions and substituted bytes are refused. The Node filesystem adapter is not
an isolation boundary against another hostile process running as the same OS user.
Directory flush is performed where supported by the filesystem. The default storage
quota is 64 MiB and can be configured up to 128 MiB independently of rendering
limits. A lock whose local owner process has exited can be recovered automatically.
An interrupted lock-reclamation claim fails closed for explicit inspection; age
alone never makes a lock safe to remove.

## Authored geometry and exports

`resolveDiagramScene(bundle)` preserves global positions, nested bounds, stacking,
shapes, connector direction and label anchors. Endpoint attachment segments are
derived from current shape geometry; manual interior bends remain authored intent.
An ordinary edit never triggers automatic layout. `previewAutomaticLayout` and
`previewResetRoute` create explicit, undoable transaction previews with affected IDs.

```js
import { exportAuthoredDiagram, verifyAuthoredDiagramExports }
  from 'planr-pipeline/diagram-authoring-export';

const result = await exportAuthoredDiagram(savedBundle, { root: workspaceRoot });
if (result.ok) {
  const verified = await verifyAuthoredDiagramExports(savedBundle, { root: workspaceRoot });
}
```

Exports retain an immutable bundle snapshot alongside SVG, PNG, portable review
HTML and a manifest. Their directory identifies the bundle and rendering
configuration. The manifest binds the complete source, renderer, theme and output
bytes; fidelity and quality reports describe limitations. Exports never replace the
canonical file. A failed export leaves earlier complete outputs intact. If export
is interrupted while promoting files, its staging directory or lock may remain.
Reusing that exact output target then fails closed until an operator verifies that
no writer remains and handles the abandoned derived files. Canonical save recovery
is independent of export cleanup.

Blank content, impossible routes, unreadable labels and excessive presentation
size return diagnostics separately from save validity. The renderer does not hide
connectors or shrink text to manufacture a successful result. PNG verification
checks integrity and dimensions against the manifest; it is not a signature that
protects against an actor replacing both an image and its metadata.

## Existing diagrams

`previewLegacyDiagramMigration({ root, slug })` verifies the existing source and
manifest and returns a proposed bundle without writing. Supported legacy semantic
kinds retain their IDs and derived bounds/routes. The preview identifies palette
changes. Unsupported grammars, generic kinds without certified meaning, changed
outputs and scene-owned sources return explicit diagnostics.

Adoption is a separate initialization action. It retains the old source, manifest
and outputs. Old render commands refuse to replace a directory containing the new
canonical bundle. Continue using legacy IR, Mermaid and Excalidraw inspection and
rendering for documents that have not been adopted.
