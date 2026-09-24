# @openplanr/artifact

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
