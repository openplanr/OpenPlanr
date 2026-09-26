# @openplanr/artifact

## 0.5.3
### Patch Changes

- 4ce826e: The hand-written editor declarations now match their implementations, verified by the new `typecheck:declarations` gate. `DiagramEditorIconName` lists every icon the editor renders (46 names, previously 16), `DiagramEditorHostPanel` declares the `icon` field the mount already validated, `DiagramEditorSession.save()` failures carry the optional `status` they return, `refresh()` conflict failures declare their `comparison`, `DiagramOwnerHttpResponse` readers return the standard `{ done, value }` discriminated union, `DiagramLocalOwnerOptions.grammar` is a `DiagramAuthoringProfile`, and `diagram-authoring` declares the `authoredDiagramPalette`, `renderAuthoredSceneElement` and `resolveDiagramSceneElement` helpers the editor imports. The Mermaid export panel no longer reads a `detail` field that copy diagnostics never carry.
- 07b3459: The design studio runtime is now built from ES modules under `lib/design/ui/` into a single `templates/studio/studio.js` that already contains the review experience, the Handoff Center and the review export tools. `templates/studio/enhancements.js` and `templates/studio/handoff-center.js` are no longer shipped, so hosts that concatenated them load `templates/studio/studio.js` alone. The studio mounts when the artifact stage announces itself with the new `planr:artifact-stage-mount` window event instead of polling for it every 30 ms. `window.__openPlanrDesignStudio`, `window.__openPlanrDesignExperience` and `window.__openPlanrDesignHandoffCenter` are unchanged; the internal `window.__openPlanrDesignHandoffBridge` and `globalThis.OpenPlanrDesignReviewExport` globals are no longer defined by the local studio.
- d0bee68: Make the shared diagram editor embeddable: responsive breakpoints follow the editor's own width instead of the window, every element id is prefixed per mount so two editors can share one document, and clicks inside host panels, the review slot, the conflict panel and the source panel no longer reach the editor's action dispatcher.
- 8ec3c42: Split the shared diagram editor into region modules (host options, template, chrome, outline, inspector, canvas, dialogs, commands, keyboard) behind the same `mountDiagramEditor` export and declaration. The editor chrome is built with DOM calls instead of an HTML string and renders the same elements, attributes and order; behaviour is unchanged. The owner runtime bundle grows from 550,201 to 562,225 bytes (116,817 gzipped), within its budget.
- ca1b9d9: Diagram layout: a relation back to an earlier node no longer stretches its cycle into one layer per node. Layers follow the forward flow, and the back relation runs around the outside of the graph into the side of its target when no direct route is clear. In a top-down or bottom-up flow, a node that shares its only predecessor with its adjacent siblings is centred on that predecessor and a node linked one-to-one with its successor is centred over it; in every flow, connectors whose ports differ by less than 12 px are drawn straight, so chains read as one column. A group frame grows on its title side, or its title moves to a free gap, so no connector crosses the title. A relation that crosses a group boundary is labelled on its run between the frames, and relation labels keep clear of group and lane borders; the quality report gains a `label-frame-overlap` check that fails a label crossing a group or lane border. Renderer 1.4.0; committed sets keep verifying and change only when rerendered.
- ca1b9d9: The diagram engine gains the `openplanr` brand theme. `theme.themeId: "openplanr"` renders Ink text with teal-on-light accents on Paper in `light` mode and Paper text with Teal accents on Ink in `dark` mode; fills, strokes, group outlines, and labels are blended from those four brand tokens and every text colour meets WCAG AA. `auto` mode emits one SVG whose inline `prefers-color-scheme` stylesheet follows the viewer, while the PNG and the review studio keep the light values. The theme also sets a compact density for README embedding: the first line of a node label is a semibold title and later lines a muted subtitle, group titles use the Outfit headline face, relation labels are 15 px, and a sequence uses 184 px participants, 16 px messages, and phase titles above each rule instead of a 176 px side rail, so a set scaled to GitHub's 880 px column stays legible. Relation labels now keep off group and lane title bands, which the quality report already rejected. The manifest and asset receipt record the theme that produced a set, Mermaid rerenders keep the document's theme mode, and an unknown theme id is now rejected instead of silently rendering the default palette. `openplanr-default` output is byte-for-byte unchanged except where a relation label sat on a container title, which its quality report already failed.
- c860f7c: The generated browser bundles under `templates/` start with a banner naming their generator and keep third-party license headers such as pako's in place. `lib/artifact/ui/generated/artifact-shell-assets.json` (schema 1.1.0) records a raw and gzip byte budget beside each asset digest.
- Updated dependencies [4ce826e]
  - @openplanr/protocol@0.6.2

## 0.5.2
### Patch Changes

- f864a94: Keep host controls outside the editor reachable while a responsive drawer is open, and stop showing the refresh recovery warning to read-only viewers.
- 2611ce1: Let hosts name the save state with `host.saveLabel(state)`, for example "Saved · revision 8", and start a new diagram from the process template with `createDiagramEditorDraft({ template: 'process' })`.
- Updated dependencies [3bcf955]
- Updated dependencies [3bcf955]
  - @openplanr/protocol@0.6.1

## 0.5.1
### Patch Changes

- 95e7562: Show a read-only view when the editor session can read but not write. Undo, Redo, Arrange, Save and the Shapes tab are not offered, Mermaid copies open on export, and hosts can name the view with `labels.readOnly`, for example "Revision 8 · Read only".

## 0.5.0
### Minor Changes

- 01f1cb5: Let hosted shells mount the shared diagram editor without forking it. A batch transport sends each save as one idempotent request that is resent exactly after an uncertain outcome, including after a reload, and hosts can supply their own wording, theme, command-bar actions and right-panel tabs. Losing access during a save now shows Access changed instead of a stuck Saving state. The outline draws nesting with guide lines, collapsible containers, tree keyboard navigation and drawn kind icons.

## 0.4.0
### Minor Changes

- c7f869c: Add the shared canvas-first diagram editor and local owner studio. Authors can create and edit shapes, connectors, containers and lanes with keyboard and pointer controls, bounded undo, conflict review, recoverable saving and read-only mobile inspection.
- cb8860e: Add certified, browser-safe Mermaid flowchart copy conversion with exact original source bytes, stable source correspondence, bounded diagnostics, explicit fidelity losses and acknowledgement before adoption. First-copy layouts now render valid visual snapshots for supported nested flowcharts and all certified directions; repository linking and watched synchronization are not part of this release.
- 53abef0: Add shared Mermaid copy import preview and fidelity-aware export controls to the diagram editor. Authors can inspect source ranges, proposed objects and visual snapshots, acknowledge exact losses, and adopt into a new unsaved diagram; complete bundle, Mermaid copy and quality-gated SVG exports remain distinct. Import into an existing saved diagram is unavailable until atomic source replacement is supported.

## 0.3.0
### Minor Changes

- 4ae7379: Save complete authored diagram bundles with durable retries and recovery, render persisted geometry through a shared portable scene, and export immutable SVG, PNG and review HTML snapshots. Add explicit selected-layout previews and read-only legacy migration inspection without changing legacy sources.
- f3958c5: Add a portable diagram editor session with atomic gesture previews, conditional undo,
  indexed hit testing, bounded clipboard data and refresh recovery. A separate local
  owner transport saves complete authored bundles through the existing durable store
  without granting review sessions access to drafts. Editor controls and authoring CLI
  commands remain separate upcoming work.
- d314fa2: Add portable editable diagram contracts and a shared deterministic edit kernel.
  
  Protocol 1.13 pairs semantic content, authored presentation, original source and source correspondence in one validated bundle. The new `planr-pipeline/diagram-authoring` API compiles explicit commands, previews atomic transactions, separates semantic and presentation changes, reports affected dependencies, and constructs conditional undo/redo without overwriting unrelated edits. IDs are supplied by callers; copy, deletion, containment, geometry locks and connector attachments use the same rules in Node, browsers and Workers.
  
  This is an additive foundation for editor and adapter implementations. Existing diagram rendering and review APIs remain supported. It does not add a canvas editor, persistence, company authorization or live collaboration. The CLI update carries the matching pipeline dependency.

### Patch Changes

- Updated dependencies [4ae7379]
- Updated dependencies [d314fa2]
  - @openplanr/protocol@0.6.0

## 0.2.3
### Patch Changes

- Updated dependencies [6508d23]
  - @openplanr/protocol@0.5.0

## 0.2.2
### Patch Changes

- Updated dependencies [f93a973]
  - @openplanr/protocol@0.4.0

## 0.2.1
### Patch Changes

- Updated dependencies [7c0e86d]
  - @openplanr/protocol@0.3.0

## 0.2.0
### Minor Changes

- 622ce31: Add permanent encrypted design reviews with separately entered access tokens,
  explicit revision publishing, private local owner custody, and synchronized
  revision-bound feedback. Fix Notes dismissal and unavailable sharing controls.
- 622ce31: Restore professional Design, Design Loop and Design Review workflows with
  adaptive consultation, portable host-native skills, and a shared authored design
  document. Render canvas, interactive prototype and walkthrough views in one
  review studio with durable feedback, scoped revision recovery, responsive
  previews and offline exports. Use a standard 1440 × 1024 desktop frame, compact
  independently collapsible navigation and review rails, and an encrypted company
  review Share flow. Add an unbounded persisted camera, direct artboard movement,
  trackpad/Space/middle-button panning, cursor-centered zoom and per-view positions.
  Keep implementation guidance in compact markers and an external Notes accordion
  so product artboards remain development-ready interfaces. Open design documents
  through `planr artifact` and preserve the authored design specification in the
  separate Plan handoff.
  
  Stabilize the mobile shell around keyboard and browser-chrome changes. Use
  readable touch-sized fields, accessible action targets and a bounded welcome
  dialog without altering authored product screens or restricting browser zoom.
- 622ce31: Render sequence diagrams as readable time-ordered conversations with participant
  headers, lifelines, phases, distinct message rows, annotations, and emphasis.
  Detect overlapping rendered labels, support sequence Mermaid and Excalidraw
  round trips, and open verified diagram manifests in the native Diagram
  studio after rendering. Use one SVG camera with outline/search, fit controls,
  compact persisted comments, and verified drawing and agent review exports;
  avoid fixed document frames and nested scrolling.

### Patch Changes

- 56c4b4b: Keep long layered graph diagrams renderable. Layer sequences that outgrow a
  readable flow axis, including large cycles and other strongly connected
  components, now wrap into balanced bands with band-aware relation routing, so a
  500-node ring renders as a compact scene instead of a 154,000-unit strip that
  viewers reject. Every node, relation, direction, and label is preserved. Split
  plans for large documents now satisfy the Protocol panel bounds while keeping
  every primary item exactly once, and any scene wider or taller than the new
  `MAX_DIAGRAM_SCENE_EXTENT` (16,384 units) fails early with
  `E_DIAGRAM_RESOURCE_BUDGET_EXCEEDED` and a split repair. The diagram renderer
  version is now 1.2.0; small diagrams render byte-identically.
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
  - @openplanr/protocol@0.2.0
