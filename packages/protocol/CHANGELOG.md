# @openplanr/protocol

## 0.2.0
### Minor Changes

- 622ce31: Add the portable company-workspace contracts and CLI workflow for public-client
  sign-in, scoped publication previews, resumable synchronization, review handoffs,
  typed change proposals, conflict detection, and explicit local application. Keep
  repository files authoritative and require the hosted service to enforce every
  organization, project, and artifact permission server-side.
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
- 622ce31: Publish the portable Protocol contracts as the MIT-licensed
  `@openplanr/protocol` package. Include the declared JavaScript and type exports,
  versioned JSON schemas, registries, and required runtime assets without internal
  preservation reports, duplicate pipeline projections, or development files.
  
  Correct `protocolAssetUrl` to resolve the packaged `schemas/v{version}/` path.
  Existing CLI and pipeline packages retain their self-contained compatibility
  projections; installing the Protocol package does not require a sibling checkout.
- 622ce31: Shorten unified-plugin invocations to `planr:<verb>` across Codex and Claude
  Code while preserving canonical `planr-*` skill identities and Cursor rules.
  Migrate managed local installations from the former `openplanr` plugin
  namespace after the replacement package is installed.
