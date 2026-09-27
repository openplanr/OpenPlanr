# @openplanr/protocol

## 0.6.2
### Patch Changes

- 4ce826e: Two contract declarations now describe what the module returns: `OPERATE_GOVERNED_CORE_PROHIBITIONS_V2` is a `readonly string[]` of prohibition ids and `findOperateCoreProhibitionV2` returns the matching id or `null` (both were declared as records), and `assertOperateRoleOutputContractV2` returns the mandate's advertised output contract with its resolved schema `path` rather than its input. Every `src/*.mjs` module is now type-checked against its `.d.mts` by the workspace `typecheck:declarations` gate.

## 0.6.1
### Patch Changes

- 3bcf955: Regenerate the command registry and its projection for the changed `planr init` command source.
- 3bcf955: Protocol artifact validation no longer deep-clones the schema, and every `$ref` target, on each call. Each packaged schema is parsed and frozen once per process and validated in place. `resolveProtocolSchema` and `resolveOperateExperienceSchemaV2` still return a mutable copy, and validation results are unchanged.

## 0.6.0
### Minor Changes

- d314fa2: Add portable editable diagram contracts and a shared deterministic edit kernel.
  
  Protocol 1.13 pairs semantic content, authored presentation, original source and source correspondence in one validated bundle. The new `planr-pipeline/diagram-authoring` API compiles explicit commands, previews atomic transactions, separates semantic and presentation changes, reports affected dependencies, and constructs conditional undo/redo without overwriting unrelated edits. IDs are supplied by callers; copy, deletion, containment, geometry locks and connector attachments use the same rules in Node, browsers and Workers.
  
  This is an additive foundation for editor and adapter implementations. Existing diagram rendering and review APIs remain supported. It does not add a canvas editor, persistence, company authorization or live collaboration. The CLI update carries the matching pipeline dependency.

### Patch Changes

- 4ae7379: Save complete authored diagram bundles with durable retries and recovery, render persisted geometry through a shared portable scene, and export immutable SVG, PNG and review HTML snapshots. Add explicit selected-layout previews and read-only legacy migration inspection without changing legacy sources.

## 0.5.0
### Minor Changes

- 6508d23: Add Protocol 1.11 contracts for design handoff readiness, implementation packages, and planning lineage. Design now exposes a deterministic fail-closed readiness compiler, while pipeline and installed OpenPlanr skill packages carry the exact generated contracts for offline validation. The new records authorize only an explicit continuation to Plan; they do not invoke Plan, Ship, Git, release, publication, or deployment actions.

## 0.4.0
### Minor Changes

- f93a973: Recognize `planr-sprint`, the backlog refinement and sprint selection skill, as a canonical skill, and regenerate the command registry for the `planr sprint refinement|diff|close|apply` subcommands and the changed `status` and `update` command sources.

## 0.3.0
### Minor Changes

- 7c0e86d: Recognize `planr-openplanr`, the routing skill, as a canonical skill in the Protocol skill catalog.

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
