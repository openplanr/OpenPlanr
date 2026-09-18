# @openplanr/artifact

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
