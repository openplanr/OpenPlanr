# @openplanr/artifact

## 0.6.1

### Patch Changes

- Updated dependencies [db8c0b9]
  - @openplanr/protocol@0.10.0

## 0.6.0

### Minor Changes

- f27d487: Make local Design Studio previews load selected screens with bounded frames, phase diagnostics and retry. Share authored sources across responsive views, support protected Studio routes and exact service lifecycle, preserve durable feedback and explicit offline imports, and add screen search, actual-size inspection and navigation links. Keep legacy artifact contracts and hosted publication limits compatible.
- f27d487: Share large designs through resumable, authenticated resource uploads and load only the selected view's resources. Use one compact Studio header with accessible menus, colorful artifact labels, stable canvas mounts and dismissible notices. Preserve drafts and exact feedback retries across interruption, offline use and concurrent tabs. Add separate room read, write and management capabilities, owned server lifecycle commands, safe company publication recovery, a versioned diagram palette and measured text and connector quality diagnostics. Existing saved revisions remain readable; hosted services must adopt the new formats before new clients create them.
  
  CLI credentials and company sign-in metadata now honor `PLANR_HOME`. When the selected home has no prior record, private legacy files are copied without changing the originals; existing destination records stay authoritative. Migration receipts prevent deleted records from being imported again. Unsafe or incomplete records require recovery rather than being treated as absent.
  
  Trusted preview hosts can opt into review selection without remounting the authored prototype or interrupting its local form state, including canonical Diagram element targets. Native taps on passive Diagram SVG select elements while Review is enabled; returning to Interact restores authored behavior.
  
  Keep large canvases responsive across browsers while preserving layout, camera controls and preview state.

### Patch Changes

- bd60e33: Correct supported Node.js versions to match the installed production dependencies. The CLI now checks support before loading prompt modules and gives an actionable error in startup, setup, doctor, and installers. Pipeline, Artifact, and Design declare their parser's Node.js 20.19 minimum. Standalone Protocol retains its Node.js 20 import contract.
- Updated dependencies [390d731]
- Updated dependencies [f27d487]
- Updated dependencies [036f395]
  - @openplanr/protocol@0.9.0

## 0.5.10
### Patch Changes

- 5c43f3a: Shared diagram reviews show the canvas status as a small caption instead of a line
  above the drawing, and space the selected element's actions as the local review does.
  The navigator names an unlabeled connection by its endpoints, such as "Owner shares the
  diagram → Reviewer opens the link". Elements without a description no longer show
  placeholder text.

## 0.5.9
### Patch Changes

- 76ef9b3: Regenerated Mermaid copies now rename node and group IDs that are Mermaid
  keywords, such as `end`, to an unused ID with an underscore suffix. Connections
  use the renamed IDs, and the export reports a `keyword-id-renamed` fidelity
  notice. This prevents invalid Mermaid output while preserving the editable
  bundle's IDs and content.
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
  - @openplanr/protocol@0.8.0

## 0.5.8
### Patch Changes

- Updated dependencies [496cd13]
  - @openplanr/protocol@0.7.3

## 0.5.7
### Patch Changes

- 0fe7327: The design studio, the design board and `planr artifact` reviews now render up to 100 MiB of HTML in total, up from 10 MiB, so a large clickable prototype renders at every frame size. Share links keep their current size limits.

## 0.5.6
### Patch Changes

- Updated dependencies [74fd3a5]
- Updated dependencies [b6a77c6]
  - @openplanr/protocol@0.7.2

## 0.5.5
### Patch Changes

- 5bd33fc: The design board no longer overwrites a board's `feedback.json` or the board token store `tokens.json` when it cannot read one: the file is kept, so earlier pins and other boards' URLs survive, and the board, the board command and `feedback resolve` report an error that names the file, without quoting it, and says how to recover. `planr-design setup` likewise leaves an unreadable `credentials.json` in place instead of replacing it, creates the file and a missing `~/.planr` owner-only from the start, and running daemons restart on the next board command (daemon version 6).
- d45f022: Diagram editor: a selected object gets a solid 2px accent outline drawn 4px outside its bounds, with no glow and no dashes, so every shape keeps its own outline. The resize handle is drawn at 8px and bend handles at a 4px radius, each inside a transparent 24px target that takes the pointer. The canvas tools are 36px buttons in a 44px bar: the pressed mode tool (Select or Pan) is solid accent, Snap is a neutral toggle whose icon shows a slash when it is off, and Zoom out and Zoom in are minus and plus icons. Status without an action floats as an 11px caption over a canvas that now runs to the bottom edge; a status that offers Retry save or Compare revisions stays a bar. Canvas objects are named as the outline names them, so an unlabelled connector reads "Start → Process". The icon set adds `minus` and `snap-off`.
- e6a0333: Diagram editor: a selected connector is traced in the accent along its own route, and its arrowheads take the accent too. The trace is one screen pixel wider than the line, never under 2px, keeps the line's dash pattern and paints under the connector's label. Before this, a selected connector without a label showed no selection on the canvas.
- 2c85b80: Diagram editor dialogs: the Delete, Connect, Layout and JSON dialogs keep their buttons in a right-aligned footer row with an 8px gap. Dialogs are at most 560px wide, with 20px padding and a 16/24 heading. The dialog and drawer scrim is one theme colour per scheme (light rgb(23 25 29 / 40%), dark rgb(5 6 8 / 64%), overridable through `--planr-color-scrim`) with no blur. In the compact layout the More menu hangs from the command bar instead of the window corner, and dialogs are capped by the editor's height rather than the window's, so a narrow or short embed keeps both inside the editor.
- ede4a77: Diagram editor: the multiple-selection inspector is flat. Align (Left, Center, Top), Distribute (Horizontal, Vertical), Structure, Clipboard and Lock are rows of equal-width buttons under sentence-case headings, and each short label keeps its full phrase ("Align left") as the accessible name. Align, Distribute, Ungroup and Move to parent are disabled with a one-line reason when they cannot apply. Deletion starts from a neutral "Delete…" or "Delete 3 objects…" button after the content; the "Danger zone" block and the reference chips are gone, and an object's reference appears only under Advanced, with a Copy button. The eyebrow above the inspector title is muted and is the editor's only uppercase text; section headings are 12px sentence case with muted icons. Selects show readable options ("Data store", "Orthogonal"), endpoint and parent pickers name objects as the outline does, and the inspector calls a connector "Connector". Selected outline rows keep ink text on a 12% accent fill with a solid accent kind chip, rows sit 2px apart, a row's kind shows in title case only when it differs from the label, the search also matches kinds ("connector"), and the search field uses the editor's magnifier icon. A disabled primary button looks like any disabled button. In the drawer layout, the inert command bar takes the drawer's backdrop, and a click on it closes the drawer. The local diagram studio now loads the artifact theme, so its colours match hosted pages; the outlined danger button has no fill, which keeps the theme's light red above 4.5:1.
- b26c196: Mermaid copy export writes labels with Mermaid's own escapes, so a copy previews again with the same labels. A label such as "Please click here" or "See href list" was exported verbatim, and the Mermaid preview then refused the copy as an unsafe construct; the first letter of `click` or `href` after whitespace is now written as a decimal entity code (`#99;lick`). Double quotes, backslashes and a `#` that would start an entity code are written as `#34;`, `#92;` and `#35;` instead of JSON escapes, which Mermaid does not read. The preview decodes decimal entity codes in labels as Mermaid does, except codes for control characters, which stay literal.
- Updated dependencies [ec8b895]
  - @openplanr/protocol@0.7.1

## 0.5.4
### Patch Changes

- c7c15dc: Protocol 1.14 adds a successor artifact theme: `registries/artifact-theme.json` with `schemas/v1.14.0/artifact-theme.schema.json`. It uses the brand teal on light (#237a72, strong #1b5f59) and adds an `onPrimary` text colour to both palettes (#ffffff light, #07110f dark). The byte-preserved `registry/artifact-theme.json` and its v1.1.0 schema are unchanged. The generated review theme CSS and JSON now come from the successor and also set `--planr-color-on-primary`, so the light review shell and Diagram Studio use the brand teal. The diagram editor's built-in light accent and Save hover use the same values. White on the light accent rises from 4.89:1 to 5.12:1; the dark accent is unchanged. A selected Mermaid source tab keeps its fill on hover, and the review shell's Copied state uses the strong accent, so their text reaches 4.5:1 (it was 4.14:1 and 3.74:1).
- ef26405: Diagram editor: the command bar is one right-aligned cluster on a 16px gutter, in this order: the save state as plain 11px text in its tone colour, Undo, Redo, Inspector, Save, host actions and More. Arrange moves into More as "Auto layout…", the outline toggle is icon-only, and pressed toggles use a neutral fill instead of the accent. Both rail headers hold only underline tabs (Outline and Shapes; Properties, Review and host panels); the "Objects" and "Inspector" title rows are gone. Accessible names match the visible labels: the inspector toggle is "Inspector" (was "Properties") and the apply button is "Apply changes" (was "Apply properties"). Full-bleed tabs, outline rows, menu items and section summaries draw their focus ring inside their own box. The right rail is 288px wide (was 320px), and in the drawer layout the inspector no longer dims or blurs the canvas it edits.
- f3ca81f: Diagram editor: type, spacing, control heights and corner radii come from one token scale. Text uses 10, 11, 12, 14, 16 and 20px with integer line heights and weights 400, 500 and 600; the base text moves from 13px to 12/18px. Buttons, fields, outline rows, menu items and section headers are 36px tall (44px on phones), spacing sits on a 4px grid, and radii are 4, 8, 12 and 14px. Field borders reach 3:1 (#858e99 light, #5e6875 dark; they were 1.33:1 and 1.39:1), and every editor input's placeholder uses the muted text colour. Hosts can set `--planr-color-{interactive,input,input-border,rule-strong,primary-soft,danger-soft,warning,scrim}`, `--planr-radius-{small,medium,large}`, `--planr-font-mono` and `--planr-shadow-{sm,md,lg}`; unset, the editor keeps its own values.
- Updated dependencies [c7c15dc]
- Updated dependencies [c373710]
- Updated dependencies [c8ef5f5]
- Updated dependencies [2d3aa3f]
- Updated dependencies [504bce4]
- Updated dependencies [711e17f]
  - @openplanr/protocol@0.7.0

## 0.5.3
### Patch Changes

- 4ce826e: The hand-written editor declarations now match their implementations, verified by the new `typecheck:declarations` gate. `DiagramEditorIconName` lists every icon the editor renders (46 names, previously 16), `DiagramEditorHostPanel` declares the `icon` field the mount already validated, `DiagramEditorSession.save()` failures carry the optional `status` they return, `refresh()` conflict failures declare their `comparison`, `DiagramOwnerHttpResponse` readers return the standard `{ done, value }` discriminated union, `DiagramLocalOwnerOptions.grammar` is a `DiagramAuthoringProfile`, and `diagram-authoring` declares the `authoredDiagramPalette`, `renderAuthoredSceneElement` and `resolveDiagramSceneElement` helpers the editor imports. The Mermaid export panel no longer reads a `detail` field that copy diagnostics never carry.
- 07b3459: The design studio runtime is now built from ES modules under `lib/design/ui/` into a single `templates/studio/studio.js` that already contains the review experience, the Handoff Center and the review export tools. `templates/studio/enhancements.js` and `templates/studio/handoff-center.js` are no longer shipped, so hosts that concatenated them load `templates/studio/studio.js` alone. The studio mounts when the artifact stage announces itself with the new `planr:artifact-stage-mount` window event instead of polling for it every 30 ms. `window.__openPlanrDesignStudio`, `window.__openPlanrDesignExperience` and `window.__openPlanrDesignHandoffCenter` are unchanged; the internal `window.__openPlanrDesignHandoffBridge` and `globalThis.OpenPlanrDesignReviewExport` globals are no longer defined by the local studio.
- c9907f2: Diagram editor: an unlabelled connector is named by its endpoints, such as "Start → Process", instead of by its internal id. The name appears in the outline, the inspector title, the delete confirmation and the status line, which now reads "Selected: Start → Process · 5 objects" for a single selection; screen readers hear "Start → Process, Connector". The Label field shows only a stored label, with the derived name as a placeholder, so applying other connector properties no longer writes the id onto the canvas as a label. The inspector header no longer repeats the selected object's id; it stays under Advanced. Delete confirmation uses real plurals ("Delete 5 objects, including 2 connectors?", "Delete 1 connector?") and lists the affected connectors by name. "Start blank" now closes the start card, which stays closed for the rest of the session once the author starts blank, applies the template or creates a shape. Field placeholders use the editor's muted text colour (4.99:1 light, 7.72:1 dark); the browser defaults fell below 4.5:1, down to 2.35:1 in WebKit.
- d0bee68: Make the shared diagram editor embeddable: responsive breakpoints follow the editor's own width instead of the window, every element id is prefixed per mount so two editors can share one document, and clicks inside host panels, the review slot, the conflict panel and the source panel no longer reach the editor's action dispatcher.
- 8ec3c42: Split the shared diagram editor into region modules (host options, template, chrome, outline, inspector, canvas, dialogs, commands, keyboard) behind the same `mountDiagramEditor` export and declaration. The editor chrome is built with DOM calls instead of an HTML string and renders the same elements, attributes and order; behaviour is unchanged. The owner runtime bundle grows from 550,201 to 562,225 bytes (116,817 gzipped), within its budget.
- 0ec2cdf: Diagram editor: a move, resize or bend drag that ends on an edit the diagram rejects, such as resizing a node past its container, now reverts to the pre-drag state and keeps the rejection visible and announced. Editing continues; previously every later edit failed with "Finish or cancel the current gesture first." until a dialog was cancelled or the page reloaded. Escape now also cancels a session gesture that no pointer drag owns.
- efdab1a: Diagram editor: Save now shows its solid primary fill while edits are pending; a group reset had made it white on the toolbar grey (1.11:1 light, 1.13:1 dark). A clean or saving Save is a neutral button at 50% opacity instead of a tinted one that looked active. Delete buttons are outlined in danger red with a soft red hover rather than a solid red fill (white on #fb7185 was 2.69:1 in dark), and hosts can set that red through the new `--planr-color-danger` custom property. Both rail headers are a fixed 44px, so the inspector header no longer shrinks when the inspector scrolls. Canvas labels use the editor's font instead of falling back to a serif where Inter is not installed; exported SVGs are unchanged.
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
