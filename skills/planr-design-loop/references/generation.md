# Author one design, render three views

Keep semantic design and code authoring in the active host agent. Deterministic
utilities package the authored result; they do not invent screens or call models.

## Editable source and identity

Use a versioned `design-document.json` and the bundled schema exposed by the
[utility](utilities.md). It names the design, stable screens and variants, authored
local HTML/CSS/JavaScript, assets, screen order, responsive frames, interaction
flows, selected direction, brief provenance and design-system references. Inspect
the schema before creating the document; validate it before rendering. Use
`schemaVersion: "1.1.0"` for documents with screen or variant props. Documents without
props may keep `schemaVersion: "1.0.0"`.

Read [team-review.md](team-review.md) and author a sibling `review-context.json`
for every new design. Its welcome purpose and review questions belong to this
design's brief and current decisions. Keep existing context when evolving the
design, updating only what changed. Render it with the same revision as the
screens so the shared welcome and implementation guidance describe that revision.

Place source in a sibling `source/` directory. Shared CSS and components belong in
shared source. Distinct design directions may use disjoint directories; theme,
partial and state instances share a screen source through typed props. Preserve
IDs during evolution.
All document source paths are local and relative to its directory; import the
required asset snapshots rather than referring outside it or to remote resources.
Fonts are asset snapshots too; follow [design-system.md](design-system.md).
Design's hosted canvas path is the one exception: it publishes to the host's
canvas service and follows that canvas's own font and asset rules.
Use stable `data-planr-id` attributes on meaningful review targets, including
primary controls and reusable component instances. Avoid anchoring feedback to
incidental array positions or rendered CSS selectors.

Author real screen content with useful labels, plausible data and complete states.
Make the primary journey navigable and meaningful controls functional. Use local
HTML/CSS/JavaScript and assets supported by the bundled utility; do not require a
build server, package installation, remote modules or a development environment to
open the studio. Third-party assets retain their license/attribution where needed.
Use classic browser scripts with local event handlers. If adapting an existing
module-based component, compile its local preview before packaging; the portable
utility does not install dependencies or compile modules. Use local image `src`
with responsive CSS. Forms validate and run local handlers; omit navigation
actions and targets. Cross-screen actions can use `data-design-navigate` with the
stable target screen ID.

For a product design, authored screen HTML is the product surface an engineer will
implement. Keep design rationale, option labels, implementation mappings, cost or
contract commentary, recommendations, and explanatory guide prose out of the
artboard. Put a short screen-level explanation in `screen.description`; the studio
exposes it as a compact note marker and an accordion outside the rendered product.
Put detailed reasoning and engineering evidence in `design-spec.md`. Use
Walkthrough for an annotated presentation. Text belongs inside the artboard only
when an end user of the product would actually see it.

Treat each product screen as development-ready: reuse production components and
tokens, show realistic content, define primary and secondary actions, include the
states needed for implementation, and make responsive and keyboard behavior
observable. If the requested deliverable is an architecture or decision diagram
rather than a product interface, route that content to the diagram workflow instead
of styling documentation as a product screen.

## Typed screen props

Declare reusable screen state in `screens[].props`. An enum declaration requires
`type: "enum"`, nonempty unique string `options`, and a `default` from those options.
A boolean declaration requires `type: "boolean"` and a boolean `default`. Prop names,
enum options and enum defaults must be lowercase tokens matching
`^[a-z][a-z0-9-]*$`, with at most 128 characters. Use `is-dark` and `dark-mode`,
for example; uppercase letters, spaces and underscores are invalid. Use props for
theme, partial content and state variants instead of copying HTML sources.

Set instance values in `variants[].props`, keyed first by screen ID and then prop
name. Omitted values use the screen defaults. For example:

```json
{
  "schemaVersion": "1.1.0",
  "screens": [
    {
      "id": "overview",
      "title": "Overview",
      "source": { "html": "source/overview.html" },
      "props": {
        "theme": { "type": "enum", "options": ["light", "dark"], "default": "light" },
        "partial": { "type": "boolean", "default": false }
      }
    }
  ],
  "variants": [
    { "id": "light", "label": "Light", "status": "ready" },
    {
      "id": "dark",
      "label": "Dark",
      "status": "ready",
      "props": { "overview": { "theme": "dark", "partial": true } }
    }
  ]
}
```

Each source with props needs exactly one explicit `<body>` screen root. The
renderer writes effective values onto that body as `data-prop-theme="dark"`,
`data-prop-partial="true"`, `prop-theme-dark` and `prop-partial-true`; false booleans
also receive an attribute and class. Names and values are written unchanged,
without case conversion or encoding. A prop named `is-dark` becomes
`data-prop-is-dark="true"` and `prop-is-dark-true`; scripts read it as
`document.body.dataset.propIsDark`. Branch CSS and local scripts on these values.
A `variants[].sources[screenId]` override still selects the source; props
apply to that selected source, otherwise to `screens[].source`. Board keys,
screen order, responsive frames and existing source overrides retain their roles.

Lint warns about copied screens only when their source files are byte-identical
after removing body `data-theme="light"` or `data-theme="dark"` attributes and
`theme-light` or `theme-dark` body classes. Other markup, styles, scripts and assets
must match. Use a shared source with a theme prop for those instances.

## Views

| View | Purpose | Required behavior |
| --- | --- | --- |
| Canvas | Compare screens and responsive artboards | Freeform coordinates, background/Space/middle-button pan, cursor-centered zoom, fit/select, persisted arrangement and per-view camera |
| Prototype | Experience the interface | Real navigation, usable forms/controls, explicit interaction versus annotation mode |
| Walkthrough | Explain the journey | Ordered screen navigator, screen descriptions and unlimited declared steps |

The same source renders in all views. Switching view or frame does not regenerate,
reinterpret copy, create new identities or lose feedback. Use explicit declared
frames. Existing breakpoints win; choose representative narrow and wide frames for
a responsive web design, and record any product-specific limitation. For a
greenfield responsive web product without an established viewport, use a
production-sized `1440 × 1024` desktop artboard, an `834 × 1194` tablet artboard
when tablet behavior matters, and a `390 × 844` mobile artboard. Treat these as CSS
viewport dimensions. Do not invent a cramped desktop width merely to make the
whole canvas fit; the studio's Fit control handles presentation scale.

Canvas tools are exclusive: Interact runs product controls, Annotate places pins,
Inspect selects elements without activating them, and Pan moves the camera. Drag
an artboard by its title to arrange it. Use I / C / H to select Interact / Annotate /
Pan; hold Space for temporary pan and Escape to leave Pan or Inspect. Switching
tools preserves comment drafts. Focused views start in Interact.

## Canvas arrangement

Author optional `layout.boards` and `layout.sections` in the design document to
arrange the canvas. Coordinates are finite world-space numbers between `-1e7`
and `1e7`. Every board key uses existing IDs: `screenId`, `screenId/frameId` or
`screenId/frameId/variantId`. Each value requires `x` and `y` and may include a
nonblank `title`.

Placement uses the exact screen/frame/variant key first, then screen/frame, then
the screen origin. A screen origin retains the grid's relative frame spacing and,
in Compare, variant-group spacing. Without a matching placement, the board uses
the computed grid. The label uses the most specific matching key with a title,
otherwise the screen's usual label. Omitting `layout` or leaving it empty retains
the default grid, labels and camera behavior.

Section headers use unique IDs and nonblank text. Each section requires `id`,
`x`, `y` and `text`; optional `maxW` is an integer from 1 to 16384 world pixels.
They appear as non-interactive headings in Canvas and contribute to Fit.

```json
{
  "layout": {
    "boards": {
      "overview": { "x": 120, "y": 180, "title": "Account journey" },
      "overview/desktop/quiet": { "x": 1800, "y": 180 }
    },
    "sections": [
      { "id": "account", "x": 120, "y": 80, "text": "Account journey", "maxW": 1200 }
    ]
  }
}
```

Dragging a board's title in the local studio writes its exact
screen/frame/variant position into the authored document and preserves an existing
title. In Canvas, Cmd/Ctrl+Z saves the prior layout; Shift+Cmd/Ctrl+Z redoes it. Preserve these fields
when revising the design. Portable studios without a local server keep drags only
for the current session. On first open, legacy positions in browser storage or
`.design/studio-state.json` fill missing exact board keys in one layout revision.
The studio removes migrated personal positions only after saving. Without a local
server, those positions apply for the session.

## Parallel alternatives

For Design Loop, define three clear hypotheses, not superficial recolors. Examples
include dense command workspace, editorial overview and focused guided journey.
Keep requirements and screen coverage comparable. Use native parallel agents when
supported, with one direction and separate source paths per agent. The coordinator
owns the shared document and specification. Sequential execution follows the same
contract. Completed variants survive another variant failing; record failures and
never claim an unavailable direction was evaluated.

The document needs an available `selectedVariant` for its initial preview. Use the
first ready direction until the user chooses; this display default is not a board
vote. Record a user preference or final winner only after explicit selection.

## Render and recover

Use [utilities.md](utilities.md) to inspect, validate, render and open the document.
Stage changes before publishing the next revision. Do not edit generated preview
HTML as the source of truth. Keep the previous working revision until the new one
is complete; report failed rendering with its cause and retained working preview.

Legacy HTML/canvas/image designs may be reviewed in place. When converting them,
preserve the original as a local source/reference and declare static image screens
as static. Existing `finalized.json` and mode-specific specification readers remain
supported. Use [craft.md](craft.md) for browser checks before finalization and
[handoff.md](handoff.md) for the complete implementation context.

## Content-sized frames

Use `height: "auto"` for long scrolling pages; keep integer heights for fixed
product viewports. Width remains an integer. Auto frames start at the tallest
integer height in the document, or 900px if all frames are auto. After load, fonts
and two animation frames, the studio measures `documentElement.scrollHeight` and
sizes the board up to 16384px. A body ResizeObserver repeats that measurement.
Fit, focused views, selection and inspection use the measured height. Grid rows
keep the initial height so later rows do not move when content is measured; arrange
long boards explicitly with `layout.boards` when they need more room.

Set `box-sizing: border-box` on the authored screen root
(`body[data-planr-screen]`), either directly or through a universal selector. The
renderer preserves authored box sizing; the browser audit checks this requirement.
The browser audit reports `vertical-overflow` when a fixed frame's document height
exceeds its viewport by more than 1px; auto frames skip this rule. `outside-frame` reports
rendered absolute/fixed elements beyond the width or height by more than 1px,
using document height for auto frames and respecting ancestor overflow clipping.

The three rules (`board-root-box-sizing`, `vertical-overflow`, `outside-frame`)
are errors throughout a document with any frame using `height: "auto"`. Use auto
frames for pages that scroll to opt into these strict checks. Otherwise the rules
are warnings and do not block verification or handoff readiness. Neither `layout`
nor `schemaVersion` changes severity; migrating or dragging a fixed-frame document
keeps its warnings. Pass the document to `auditDesignPage` with its revision and
entries when running browser checks.
