# @openplanr/protocol

## 0.11.0

### Minor Changes

- 625c09f: Drop Node.js 20, which reached end of life in April 2026. This is a breaking CLI change: `openplanr` now requires Node.js `^22.13.0 || >=23.5.0`, and the pipeline and Protocol require Node.js 22.13.0 or later.
  
  Run `node -v` to check your version. If it reports v20, or a 22 release below 22.13, install Node.js 24 LTS or Node.js 22.13 or later, then rerun the installer or `npm install --global openplanr`.
  
  On Node.js 20 the install scripts stop before installing anything with `E_NODE_VERSION: OpenPlanr requires Node.js ^22.13.0 || >=23.5.0; found v20.x.y.` `npm install --global openplanr` only warns about the engines range, and `openplanr` then stops before loading anything with `E_NODE_VERSION: OpenPlanr requires Node.js ^22.13.0 || >=23.5.0; found 20.x.y.` `openplanr-pipeline doctor` fails its Node.js check with `Node 20.x.y does not satisfy engines.node >=22.13.0`, and the delegate skill's probe reports that Node 22 or later is required.

### Patch Changes

- 50fb215: The plan skill now ends with the host's ship command, `/planr:ship T-NNN` in Claude Code, `$planr:ship T-NNN` in Codex or the `planr-ship` rule in Cursor, instead of `/planr-ship` and `$planr-ship`. The pipeline's plan procedures point to `/planr:plan` instead of the retired `planr spec decompose` command.
- 2ed98ac: After a CLI upgrade, `openplanr upgrade status` reports `agents-behind` instead of `incompatible` when only your coding agents need updating, and lists the commands to run. When a file in an installed runtime package was edited, `openplanr runtime update` and `openplanr setup` name the file and stop, and `openplanr doctor --fix` restores the package from the CLI after you confirm, backing up the changed files first; `upgrade status` points there instead of at a step that would fail. Error messages keep relative paths such as `skills/delegate/scripts/context.mjs` intact.

## 0.10.3

### Patch Changes

- ac4c5c4: The database agent no longer reads `DB_PASSWORD` or passes any password or connection string. It connects only where the database client signs in on its own: a PostgreSQL service with `~/.pgpass`, a MySQL login path, MongoDB OIDC, X.509 or AWS authentication or a local server without authentication, or a trusted MSSQL connection. Without one, it asks you to set one up or run the scan yourself.
- 96f616b: `delegate` classifies credentials by syntax. Member references such as `config!.apiKey` in code, type annotations ending in `;` or `,`, and self-describing test values such as `test_secret_must_be_…` now reach the delegated agent unchanged, while recognizable credentials, private keys and credential files stay blocked. A blocked source lists masked findings with location, rule and confidence; for an optional source they appear only in the prepare preview, never in the delegated context. After you confirm that a specific finding is not a credential, `prepare` accepts it through `credentialResolutions` for those exact bytes only, and the preview lists every accepted resolution.
- ac4c5c4: `delegate` checks a local model server without sending a token: it no longer reads or sends `LM_STUDIO_API_KEY`, `LM_API_TOKEN` or the Claude `ANTHROPIC_AUTH_TOKEN`. A server that requires sign-in is reported as not checked, and the run can still start with the delegated agent's own sign-in.
- ac4c5c4: The sync, sprint and status skills reach GitHub and Linear through your coding agent's own connection, or the GitHub CLI when it is signed in, and name the connection to add when one is missing. They no longer use the Linear token that `openplanr linear` stores; `openplanr linear` keeps working in a terminal. After `openplanr sprint apply`, the sprint skill updates the issue linked to each changed item.
- d2ef7a8: The Claude Code plugin pre-approves no tools: the seven Operate review skills drop their `allowed-tools` grant, so the package qualifies as instructions-only and every write follows your normal permission prompts. An Operate lens run on its own now creates the same `.planr/operate/<date>-<slug>/` cycle `planr-operate` creates, with a one-lens roster, so the dashboard lists it.
  
  Role agents are simpler and current: descriptions no longer route by task file names or pipeline step numbers, legacy role names are gone, and most roles inherit the session's tools. The QA agent denies the file-editing tools and the DevOps agent keeps no shell; both boundaries are documented as what the host enforces. Plan decomposes a story into coherent, independently verifiable tasks split by ownership instead of a fixed one-or-two-task count.

## 0.10.2

### Patch Changes

- 9557ccf: `@openplanr/protocol/names` exports `PLANNING_FOLDER` and `CLI_COMMAND`, the planning folder and command names. The CLI, the pipeline and the bundled sync skill read them from there instead of spelling them out. Output is unchanged.
- d4f1cc8: The command is now `openplanr`, with `opr` as its short alias. `planr` keeps working in this release and prints a one-line notice; it will be removed in the next release, so switch scripts, shell aliases and CI to `openplanr` or `opr`. `openplanr doctor` reports installed skills that still use the old command and how to refresh them. Skill names such as `/planr:plan`, the `planr` plugin and the `.planr/` folder are unchanged.
- 28bee48: The pipeline command is now `openplanr-pipeline`. `planr-pipeline` keeps working in this release and prints a one-line notice; it will be removed in the next release, so switch scripts to `openplanr-pipeline`.
- d4f1cc8: OpenPlanr no longer writes into a `.planr/` folder it didn't create. When that folder has no OpenPlanr `config.json` but holds other planning files, `openplanr init`, project setup, provenance appends and design taste updates stop and list what they found. Move or rename that folder, or use OpenPlanr in another repository.

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
