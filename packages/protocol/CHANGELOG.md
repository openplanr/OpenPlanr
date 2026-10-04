# @openplanr/protocol

## 0.10.1

### Patch Changes

- 5c51ad8: Improve offline Studio and review runtime packaging while preserving existing designs and installations. Verify packaged files before publication and restore the previous package if an update fails.
  
  Use profile-specific authentication for local model diagnostics.

## 0.10.0

### Minor Changes

- db8c0b9: Skill cards and summaries consistently use OpenPlanr branding and clearly report
  completed work, useful deliverables, checks and remaining action. Activation
  descriptions come from each skill's frontmatter. Setup and doctor accept recorded
  skill discovery modes through an additive runtime-lock contract while preserving
  legacy locks and native namespaces.

## 0.9.0

### Minor Changes

- 390d731: Add planr-delegate to the canonical skill catalog for explicit second-agent implementation requests. Ordinary implementation and native parallel roles remain host-native Ship; agent review requests do not trigger implementation delegation. No frozen adapter protocol or public command is changed.
- f27d487: Make local Design Studio previews load selected screens with bounded frames, phase diagnostics and retry. Share authored sources across responsive views, support protected Studio routes and exact service lifecycle, preserve durable feedback and explicit offline imports, and add screen search, actual-size inspection and navigation links. Keep legacy artifact contracts and hosted publication limits compatible.
- 036f395: Add versioned contracts for shared-source designs, resumable encrypted resources, company publication references, isolated preview messages, authenticated review rooms and diagram presentation. Keep historical schemas and readers unchanged. These additive contracts define the formats; hosted services and Studio clients adopt them in subsequent changes.

## 0.8.0
### Minor Changes

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

## 0.7.3
### Patch Changes

- 496cd13: `planr upgrade apply`, `planr runtime update` and `planr setup` now print only what changed. After an upgrade you see the new version, up to five highlights per release with a link to the full release notes (`--notes full` prints every entry), and one command per installed coding agent, planned by the newly installed CLI instead of the version you upgraded from. `planr runtime update` prints one line per coding agent and which ones to restart; `--verbose` adds the changed files and `--json` prints the full result.

## 0.7.2
### Patch Changes

- 74fd3a5: The bundled design helper in the design, design-loop, design-review and plan skills now ships as `scripts/design.mjs` plus flat sibling `scripts/design-*.mjs` modules, each under 256 KiB and unminified, so the Claude Code plugin meets the plugin directory's per-file size limit. Commands, flags and output are unchanged. The skill registry and the pipeline's protocol projection carry the new resource digests.
- b6a77c6: The `planr-sync` skill's bundled helper no longer talks to Linear or reads `PLANR_LINEAR_TOKEN`. Linear synchronization runs through the host's Linear connector or the `planr linear` CLI, which stores its own token. To migrate, run `planr linear init` once, audit with `planr linear sync --dry-run`, and create or update issues with `planr linear push <artifact-id>`. `sync.mjs linear …` now exits with `E_SYNC_USAGE` and names these commands. GitHub and local reconciliation are unchanged and still need no CLI.

## 0.7.1
### Patch Changes

- ec8b895: The shipped command registry carries the new digest of the `planr github` command source.

## 0.7.0
### Minor Changes

- c7c15dc: Protocol 1.14 adds a successor artifact theme: `registries/artifact-theme.json` with `schemas/v1.14.0/artifact-theme.schema.json`. It uses the brand teal on light (#237a72, strong #1b5f59) and adds an `onPrimary` text colour to both palettes (#ffffff light, #07110f dark). The byte-preserved `registry/artifact-theme.json` and its v1.1.0 schema are unchanged. The generated review theme CSS and JSON now come from the successor and also set `--planr-color-on-primary`, so the light review shell and Diagram Studio use the brand teal. The diagram editor's built-in light accent and Save hover use the same values. White on the light accent rises from 4.89:1 to 5.12:1; the dark accent is unchanged. A selected Mermaid source tab keeps its fill on hover, and the review shell's Copied state uses the strong accent, so their text reaches 4.5:1 (it was 4.14:1 and 3.74:1).

### Patch Changes

- c373710: The shipped command registry carries the new digests of the CLI command files that now validate artifact ids and template names.
- c8ef5f5: `planr operate dashboard` and `planr-pipeline dashboard` now load `startDashboard` from `planr-pipeline/dashboard` instead of the deprecated package-root alias. Behavior is unchanged; the command registry and its projection record the two changed command sources.
- 2d3aa3f: The remaining source modules over 800 lines open with a short comment that names what the module owns and its entry points, and three module comments that misdescribed their files now match the code. Only comments change: code, exports and behaviour are unchanged, and the bundled dashboard assets differ only in their source-derived build id.
- 504bce4: Source modules over 800 lines open with a short comment that names what the module owns and its entry points, and several stale comments now match the code. Only comments change: code, exports and behaviour are unchanged, and the bundled dashboard assets differ only in their source-derived build id.
- 711e17f: `@openplanr/protocol/canonical-json` exports `deepFreeze` and `assertPlainData(value, label)`. The Protocol contracts, the Operate, artifact and design runtimes and the dashboard now use them instead of their own copies; what is frozen, what is rejected and every error message are unchanged.

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
