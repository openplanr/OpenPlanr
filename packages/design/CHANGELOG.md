# @openplanr/design

## 0.3.0
### Minor Changes

- 3bcf955: The design-loop engine no longer picks OpenAI just because a key is present: `auto` always resolves to the $0 `claude-svg` provider, OpenAI runs only behind an explicit `--provider openai` (defaulting to `gpt-5.5` with the `gpt-image-2.5-sunburst` image model, overridable with `--model` and `--image-model`; `--size` and `--quality` validate the documented values), the billed PNG `check` and `taste` vision calls need the same flag, and requesting OpenAI without a key fails naming `planr-design setup`.

### Patch Changes

- Updated dependencies [f864a94]
- Updated dependencies [2611ce1]
- Updated dependencies [3bcf955]
- Updated dependencies [3bcf955]
  - @openplanr/artifact@0.5.2
  - @openplanr/protocol@0.6.1

## 0.2.7
### Patch Changes

- Updated dependencies [95e7562]
  - @openplanr/artifact@0.5.1

## 0.2.6
### Patch Changes

- Updated dependencies [01f1cb5]
  - @openplanr/artifact@0.5.0

## 0.2.5
### Patch Changes

- Updated dependencies [c7f869c]
- Updated dependencies [cb8860e]
- Updated dependencies [53abef0]
  - @openplanr/artifact@0.4.0

## 0.2.4
### Patch Changes

- Updated dependencies [4ae7379]
- Updated dependencies [f3958c5]
- Updated dependencies [d314fa2]
  - @openplanr/artifact@0.3.0
  - @openplanr/protocol@0.6.0

## 0.2.3
### Patch Changes

- Updated dependencies [6508d23]
  - @openplanr/protocol@0.5.0
  - @openplanr/artifact@0.2.3

## 0.2.2
### Patch Changes

- Updated dependencies [f93a973]
  - @openplanr/protocol@0.4.0
  - @openplanr/artifact@0.2.2

## 0.2.1
### Patch Changes

- Updated dependencies [7c0e86d]
  - @openplanr/protocol@0.3.0
  - @openplanr/artifact@0.2.1

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

### Patch Changes

- Updated dependencies [56c4b4b]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
  - @openplanr/artifact@0.2.0
  - @openplanr/protocol@0.2.0
