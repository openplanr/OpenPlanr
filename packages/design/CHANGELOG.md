# @openplanr/design

## 0.4.8

### Patch Changes

- Updated dependencies [9d60c2d]
  - @openplanr/protocol@0.13.0
  - @openplanr/artifact@0.6.8

## 0.4.7

### Patch Changes

- Updated dependencies [0b4992c]
  - @openplanr/protocol@0.12.0
  - @openplanr/artifact@0.6.7

## 0.4.6

### Patch Changes

- 7038c01: Keep Studio view controls centered in their workspace and actions usable on narrow screens and with enlarged text. Shared dialogs, drawers and menus preserve keyboard focus, while changing views retains prototype state, camera position and annotation drafts.
- 625c09f: Drop Node.js 20, which reached end of life in April 2026. This is a breaking CLI change: `openplanr` now requires Node.js `^22.13.0 || >=23.5.0`, and the pipeline and Protocol require Node.js 22.13.0 or later.
  
  Run `node -v` to check your version. If it reports v20, or a 22 release below 22.13, install Node.js 24 LTS or Node.js 22.13 or later, then rerun the installer or `npm install --global openplanr`.
  
  On Node.js 20 the install scripts stop before installing anything with `E_NODE_VERSION: OpenPlanr requires Node.js ^22.13.0 || >=23.5.0; found v20.x.y.` `npm install --global openplanr` only warns about the engines range, and `openplanr` then stops before loading anything with `E_NODE_VERSION: OpenPlanr requires Node.js ^22.13.0 || >=23.5.0; found 20.x.y.` `openplanr-pipeline doctor` fails its Node.js check with `Node 20.x.y does not satisfy engines.node >=22.13.0`, and the delegate skill's probe reports that Node 22 or later is required.
- Updated dependencies [7038c01]
- Updated dependencies [625c09f]
- Updated dependencies [50fb215]
- Updated dependencies [2ed98ac]
  - @openplanr/artifact@0.6.6
  - @openplanr/protocol@0.11.0

## 0.4.5

### Patch Changes

- 58430d8: Local Studio previews now give prototypes the bounded prototype-state API and each screen's logical id, so prototypes that keep state across screens work in local review. Stored artifacts are unchanged.
- Updated dependencies [ac4c5c4]
- Updated dependencies [96f616b]
- Updated dependencies [ac4c5c4]
- Updated dependencies [ac4c5c4]
- Updated dependencies [d2ef7a8]
  - @openplanr/protocol@0.10.3
  - @openplanr/artifact@0.6.5

## 0.4.4

### Patch Changes

- Updated dependencies [9557ccf]
- Updated dependencies [d4f1cc8]
- Updated dependencies [28bee48]
- Updated dependencies [d4f1cc8]
  - @openplanr/protocol@0.10.2
  - @openplanr/artifact@0.6.4

## 0.4.3

### Patch Changes

- 9b44c2d: Align Design Studio mode controls with header actions, including consistent phone touch targets and visible hover, selected and keyboard-focus states.
- Updated dependencies [9b44c2d]
  - @openplanr/artifact@0.6.3

## 0.4.2

### Patch Changes

- Updated dependencies [5c51ad8]
  - @openplanr/protocol@0.10.1
  - @openplanr/artifact@0.6.2

## 0.4.1

### Patch Changes

- Updated dependencies [db8c0b9]
  - @openplanr/protocol@0.10.0
  - @openplanr/artifact@0.6.1

## 0.4.0

### Minor Changes

- f27d487: Make local Design Studio previews load selected screens with bounded frames, phase diagnostics and retry. Share authored sources across responsive views, support protected Studio routes and exact service lifecycle, preserve durable feedback and explicit offline imports, and add screen search, actual-size inspection and navigation links. Keep legacy artifact contracts and hosted publication limits compatible.
- f27d487: Share large designs through resumable, authenticated resource uploads and load only the selected view's resources. Use one compact Studio header with accessible menus, colorful artifact labels, stable canvas mounts and dismissible notices. Preserve drafts and exact feedback retries across interruption, offline use and concurrent tabs. Add separate room read, write and management capabilities, owned server lifecycle commands, safe company publication recovery, a versioned diagram palette and measured text and connector quality diagnostics. Existing saved revisions remain readable; hosted services must adopt the new formats before new clients create them.
  
  CLI credentials and company sign-in metadata now honor `PLANR_HOME`. When the selected home has no prior record, private legacy files are copied without changing the originals; existing destination records stay authoritative. Migration receipts prevent deleted records from being imported again. Unsafe or incomplete records require recovery rather than being treated as absent.
  
  Trusted preview hosts can opt into review selection without remounting the authored prototype or interrupting its local form state, including canonical Diagram element targets. Native taps on passive Diagram SVG select elements while Review is enabled; returning to Interact restores authored behavior.
  
  Keep large canvases responsive across browsers while preserving layout, camera controls and preview state.

### Patch Changes

- f27d487: Make Design Studio notifications dismissible, keep repeated dismissed sync warnings closed, and clear save warnings after a successful retry while preserving unsaved drafts.
- bd60e33: Correct supported Node.js versions to match the installed production dependencies. The CLI now checks support before loading prompt modules and gives an actionable error in startup, setup, doctor, and installers. Pipeline, Artifact, and Design declare their parser's Node.js 20.19 minimum. Standalone Protocol retains its Node.js 20 import contract.
- Updated dependencies [390d731]
- Updated dependencies [f27d487]
- Updated dependencies [f27d487]
- Updated dependencies [036f395]
- Updated dependencies [bd60e33]
  - @openplanr/protocol@0.9.0
  - @openplanr/artifact@0.6.0

## 0.3.9
### Patch Changes

- Updated dependencies [5c43f3a]
  - @openplanr/artifact@0.5.10

## 0.3.8
### Patch Changes

- 76ef9b3: The **Share design** dialog keeps its primary button label readable in light and
  dark themes at rest, on hover, when pressed and during keyboard focus. Disabled
  buttons retain their disabled appearance instead of picking up the hover fill.
- 76ef9b3: Share a verified diagram manifest or authored bundle as a native encrypted review:
  
  ```bash
  planr artifact share <manifest-or-bundle>
  planr artifact publish <manifest-or-bundle>
  planr artifact sync <manifest-or-bundle>
  ```
  
  The local studio's **Share diagram** dialog previews the selected title, revision,
  publication contents, destination and retention. It provides separate controls
  for copying the stable link and access token. Reviews work while the owner's
  laptop is offline and last until revoked or deleted. The native viewer preserves
  saved geometry and provides outline/search, inspection, pan/zoom, Fit, Present,
  Discussion, Revisions, and SVG/PNG or feedback exports without an HTML wrapper.
  
  Publish later revisions explicitly to the same link. Sync revision-bound feedback
  into the local ledger without changing the diagram; earlier revisions remain
  readable and do not accept new comments. Owner credentials stay outside the
  repository and ordinary command output remains credential-free.
  
  Protocol 1.15 adds `@openplanr/protocol/diagram-review-contracts`, with validators
  and TypeScript types for diagram review bundles, feedback and encrypted workspace
  records. Its six schemas are `schemas/v1.15.0/diagram-review-bundle.schema.json`,
  `diagram-review-feedback.schema.json`, `diagram-review-workspace.schema.json`,
  `diagram-workspace-create.schema.json`, `diagram-workspace-revision.schema.json`
  and `diagram-workspace-event.schema.json`. These additive contracts use payload
  `schemaVersion: "1.0.0"`; existing schema versions remain unchanged.
  
  Diagram sharing requires a compatible hosted service. An older runtime or service
  reports `E_DIAGRAM_SHARE_UNSUPPORTED`. Existing HTML reviews and design links keep
  working and are not migrated or republished automatically.
- Updated dependencies [76ef9b3]
- Updated dependencies [76ef9b3]
  - @openplanr/artifact@0.5.9
  - @openplanr/protocol@0.8.0

## 0.3.7
### Patch Changes

- fcc1c89: Design Share stores each repeated screen, script and style once and compresses the review before encrypting it, so large designs fit the upload limit. A 13-screen design at three sizes shrank from 19 MiB to 0.24 MiB. Links shared earlier keep opening.

## 0.3.6
### Patch Changes

- Updated dependencies [496cd13]
  - @openplanr/protocol@0.7.3
  - @openplanr/artifact@0.5.8

## 0.3.5
### Patch Changes

- 0fe7327: The design studio, the design board and `planr artifact` reviews now render up to 100 MiB of HTML in total, up from 10 MiB, so a large clickable prototype renders at every frame size. Share links keep their current size limits.
- Updated dependencies [0fe7327]
  - @openplanr/artifact@0.5.7

## 0.3.4
### Patch Changes

- Updated dependencies [74fd3a5]
- Updated dependencies [b6a77c6]
  - @openplanr/protocol@0.7.2
  - @openplanr/artifact@0.5.6

## 0.3.3
### Patch Changes

- 5bd33fc: The design board no longer overwrites a board's `feedback.json` or the board token store `tokens.json` when it cannot read one: the file is kept, so earlier pins and other boards' URLs survive, and the board, the board command and `feedback resolve` report an error that names the file, without quoting it, and says how to recover. `planr-design setup` likewise leaves an unreadable `credentials.json` in place instead of replacing it, creates the file and a missing `~/.planr` owner-only from the start, and running daemons restart on the next board command (daemon version 6).
- b6d7fdb: A new comment on a local design review no longer shows "Its type is waiting to sync" and a "Retry pending categories" button: the studio now saves the comment before its type, so the type is stored on the first try.
- Updated dependencies [5bd33fc]
- Updated dependencies [d45f022]
- Updated dependencies [e6a0333]
- Updated dependencies [2c85b80]
- Updated dependencies [ede4a77]
- Updated dependencies [ec8b895]
- Updated dependencies [b26c196]
  - @openplanr/artifact@0.5.5
  - @openplanr/protocol@0.7.1

## 0.3.2
### Patch Changes

- 6c36af3: The design-loop board shows each variant as its own image. `design-engine generate --provider openai` (also through `variants` and `evolve`) and `design-engine record` no longer write a `variant-{X}.html` React canvas and a `vendor/` copy of React 18 next to the image, so `design-engine board` no longer stops with `Artifact ./vendor/react-dom.production.min.js contains remote URL.` on the rounds they wrote. The board frames `variant-{X}.png` or `variant-{X}.svg` at the image's own size and keeps its zoom, views, pins, ratings and PNG or SVG source export. planr-pipeline no longer ships `templates/design/canvas-shell.html`, `templates/design/DesignCanvas.jsx`, `templates/design/vendor/react.production.min.js`, `templates/design/vendor/react-dom.production.min.js`, `templates/design/vendor/DesignCanvas.js`, `templates/design/vendor/fetch-vendor.mjs` or `lib/design-engine/canvas-wrap.mjs`; `discoverVariants` and `imageDimensions` are exported from `lib/design-engine/artifact-adapter.mjs`. In a session directory written by an earlier version, delete `variant-{X}.html` and `vendor/` before running `design-engine board` there. The legacy `/design` generate, handoff and review procedures (`procedures/design-step2-generate.md`, `procedures/design-step3-spec-and-handoff.md` and `procedures/design-review-loop.md`) are retired along with the template renderer only they used (`templates/design/prototype-shell.html`, `templates/design/walkthrough-shell.html`, `templates/design/vendor/pretext.js` and `templates/design/README.md`); the `/planr:design`, `/planr:design-loop` and `/planr:design-review` skills render through the design studio and never read them.
- Updated dependencies [c7c15dc]
- Updated dependencies [c373710]
- Updated dependencies [c8ef5f5]
- Updated dependencies [ef26405]
- Updated dependencies [f3ca81f]
- Updated dependencies [2d3aa3f]
- Updated dependencies [504bce4]
- Updated dependencies [711e17f]
  - @openplanr/protocol@0.7.0
  - @openplanr/artifact@0.5.4

## 0.3.1
### Patch Changes

- 1e78b40: A design board daemon started by the board command now keeps running after the command exits. It used to write its stderr to a pipe the command closed on exit, so its first later message, such as the notice logged when a board registers, failed with `EPIPE` and stopped it, and the printed board URL no longer answered. The daemon now writes its stderr to `daemon.log` in the daemon state directory (`~/.planr/design-daemon/`, owner-only), and the previous daemon's log is kept as `daemon.log.1`. The board command still relays the daemon's startup notices and still fails at once with the daemon's exit code and error when it cannot start.
- 245924c: The design board daemon no longer replaces an unreadable board registry with an empty one. At startup, a `boards.json` that is not valid JSON or not a map of board ids to directories is moved aside intact to `boards.json.corrupt-<timestamp>`; the board command prints the daemon's notice naming both paths and the parse failure, and the daemon starts empty. Run the board command again to re-register each board. If the registry becomes invalid while the daemon runs, board routes fail with an error naming the file, `/health` still identifies the daemon and reports the error, and the next board command restarts the daemon, which sets the registry aside. A registry the daemon cannot read at all stops it from starting, and the board command now fails at once with the daemon's exit code and error, which names the file, instead of waiting 5 seconds and reporting only a timeout. Registry saves now replace the file atomically with owner-only permissions. The daemon version is now 5, so running daemons restart on the next board command.
- 07b3459: The design studio runtime is now built from ES modules under `lib/design/ui/` into a single `templates/studio/studio.js` that already contains the review experience, the Handoff Center and the review export tools. `templates/studio/enhancements.js` and `templates/studio/handoff-center.js` are no longer shipped, so hosts that concatenated them load `templates/studio/studio.js` alone. The studio mounts when the artifact stage announces itself with the new `planr:artifact-stage-mount` window event instead of polling for it every 30 ms. `window.__openPlanrDesignStudio`, `window.__openPlanrDesignExperience` and `window.__openPlanrDesignHandoffCenter` are unchanged; the internal `window.__openPlanrDesignHandoffBridge` and `globalThis.OpenPlanrDesignReviewExport` globals are no longer defined by the local studio.
- Updated dependencies [4ce826e]
- Updated dependencies [4ce826e]
- Updated dependencies [07b3459]
- Updated dependencies [c9907f2]
- Updated dependencies [d0bee68]
- Updated dependencies [8ec3c42]
- Updated dependencies [0ec2cdf]
- Updated dependencies [efdab1a]
- Updated dependencies [ca1b9d9]
- Updated dependencies [ca1b9d9]
- Updated dependencies [c860f7c]
  - @openplanr/artifact@0.5.3
  - @openplanr/protocol@0.6.2

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
