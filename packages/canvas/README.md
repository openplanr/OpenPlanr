# @openplanr/canvas

Framework-free camera, input, culling and overview controller for HTML and SVG content. The package
is private and is not published. It has no runtime dependencies; React peers
remain optional.

Exports:

- `.`: `createCanvas`, `cameraFromScreenTranslate`, `cameraToScreenTranslate`,
  `drawCameraOverview`, `drawMinimap`, `minimapToWorld`,
  and their camera, geometry, node, options, elements, events and controller types.
- `./react`: Empty entry reserved for React bindings.
- `./testing`: `generateLayeredGraph`, `generateSvgDiagram`, `percentile95`,
  `rendererFrameWork`, and their fixture and trace types.
- `./styles.css`: Structural canvas styles and z-order variables.

`createCanvas({ label })` creates a detached controller. Call `attach({ stage,
world, overlays })` to connect elements, `detach()` to release them, and
`destroy()` to end its lifetime. Attach and detach are idempotent. Calls after
destroy throw; returned unsubscribe functions remain safe. Worlds and overlays must be HTML elements; SVG groups throw a `TypeError`
naming the field. The camera writes only CSS transforms on those wrappers.
Render SVG content inside a static `<svg>` positioned at its content bounds with
a matching `viewBox`. Pass an edge SVG as `edges` to let the engine size and
position it around its drawn routes. Consumers render node content and register
its element with `registerNodeElement(id, element)`; pass `null` when unmounting.
Mark frame wrappers with `data-canvas-node-id` matching a node with `frame: true`.

Camera coordinates `{ x, y, zoom }` identify the world point at the stage's top
left. `panBy` advances this point by screen pixels divided by zoom. Use
`getCamera`, `setCamera`, `zoomAt`, `worldToScreen` and `screenToWorld` for camera
operations. The translation converters preserve Studio's `{ x, y, scale }` store.
Default zoom limits are 0.04 and 4. Optional padded world bounds constrain pan.
Animated `setCamera` moves take at most 200 ms and honor reduced motion and
`motion: 'none'`.

`setNodes` stores bounds for `fit('all' | 'selection' | ids, { padding, maxZoom })`
and `reveal(id, { mode: 'minimal' | 'center' })`. `setSelection` and `getSelection`
manage the selected IDs. Fit and reveal use the full stage. A 512 px spatial grid tracks incremental
node changes. `on('mount', listener)` supplies the complete mounted ID set;
`getMountedIds()` reads it synchronously. `hitTest(screenPoint)` queries the
spatial grid and returns the topmost matching node ID or `null`. Render those IDs and update existing
content for the changed IDs in `on('geometry', listener)`.

The mounted region is twice the viewport size around its centre. Optional
mounts arrive nearest the stage centre, at most 200 per animation frame. Zoom
changes freeze optional admissions until 120 ms after the last zoom change;
unmounts, geometry and pinned admissions continue. `setPinned(source, ids)`
keeps independent pin sources. Selection and registered focused elements pin
their nodes internally. Optional `culling.cellSize` and `culling.marginFactor`
override the defaults. Safe-area chrome and the outline remain pending.

`lod` defaults to `{ compactBelow: 0.60, overviewBelow: 0.40, hysteresis: 0.03 }`;
`lod: false` keeps DOM rendering. Levels switch below 0.57 and 0.37, returning
above 0.63 and 0.43. Subscribe to `level` and query `getLevel(id)` to render
compact cards while every pinned, focused, selected or edited node stays full.
Mark edited nodes with `setPinned('editing', ids)`. Overview hides the world and
edge SVG, releases optional mounts and preserves visible pinned wrappers. The
overview remains visible until returning DOM mounts are ready after the zoom freeze.

Pass an optional `overview` canvas on attach, or let the controller create it.
`overviewStyle(node)` supplies fill and stroke. The default canvas 2D renderer
translates a cached bitmap during stable pans; `getOverviewMetrics()` reports
its pixel bytes and redraws. The cache holds at most 4,194,304 pixels (16 MiB of
RGBA pixels). Active zoom scales the bitmap until its zoom ratio leaves 0.5 to 2
or the view leaves its cached region, with one fresh draw after 150 ms without a zoom change.
`overviewRenderer: 'worker'` opts into the experimental
OffscreenCanvas renderer and reports measured presentation lag in frames; it
throws when workers or OffscreenCanvas are unavailable. `drawMinimap` fits all
nodes into a letterboxed target and returns the transform for `minimapToWorld`.

`setEdges` supplies edges with `id`, `from`, `to`, `style`, and optional world
`points`. Routes intersecting the mounted region draw as one path per style,
even when both endpoints are culled. Flat routes receive a one-pixel viewport
extent so their stroke remains visible. Unknown endpoints appear in
`getDiagnostics()` and the `diagnostics` event; `strict: true` throws instead.

`setPointerMode('pan' | 'none')` controls empty-stage drag. Wheel pans; Ctrl/Cmd
plus wheel and trackpad pinch zoom at the pointer by `exp(-deltaY * 0.01)`,
clamped to 0.8 to 1.25 per event after normalizing deltas to pixels. Safari
gesture events use their own scale ratio. Space on the focused stage and the
middle button pan in either mode. Frame previews are shielded until
`setActiveFrame(id)` and while moving. The host Done button, outside click,
`setActiveFrame(null)` or `deactivateFrame()` leave frame interaction.
`getActiveFrame()` returns its ID. Frame previews boot one at a time, nearest
first, and pause during pan or pinch. Desktop, tablet and mobile live budgets
are 10, 6 and 3; deferred previews show a Load action. Recently live frames have
a 180 second keep-alive within the budget. Live iframe elements stay connected
in stable world-layer portals while their product wrappers are culled. Optional `breakpoints: [{ name, minWidth }]` determines
`getBreakpoint()` and the `breakpoint` event. Sorted by minimum width, the widest
configured breakpoint gets 10 live frames, the next gets 6, and narrower ones get
3. Without configured breakpoints, the name is `null` and the budget is 10.
Iframe sources supplied by a renderer may begin navigation before the engine
observes their insertion; the scheduler controls subsequent admissions.

The stage handles `+`/`=` and `-` for zoom, `0` for 100%, Shift+1 to fit all,
Shift+2 to fit selection, and Shift+Arrows to pan by a quarter stage. Set
`keyboard.arrows: 'none'` to leave all arrows to the product. Shortcuts ignore
editable focus, IME composition and a false `shortcutsEnabled()` result. Browser
page zoom keys pass through. A product coordinator may call `handleKey(event)`;
it returns true only when consumed, and the same event is consumed once.

Event subscriptions return unsubscribe functions. Camera and active-frame
events coalesce and run after the frame's transform write. Selection changes
also emit `selection`. Invalid
inputs throw `TypeError` with the field and value.

Run `npm test --workspace=@openplanr/canvas`, `npm run test:browser
--workspace=@openplanr/canvas`, or `npm run bench:trace
--workspace=@openplanr/canvas`. The production Vite bench accepts `fixture`,
`world`, `pointerMode`, `zoom`, `frame=1`, `frames=15` and `overviewRenderer` query parameters.
It renders through mount and geometry events and shows the mounted count. Trace results are written to
`test-results/bench-trace.json`; the measured reference and runner results appear
together in its report. Each scenario records three runs and reports median
p95s with all raw results. A discarded warm-up precedes the 708-node interaction
runs. Every scenario and raw trace run includes the WebGL renderer string.
Local runs keep every reference budget unchanged. All four scenarios gate main-thread, rAF, long-task, first-frame
and hit-test budgets for the 708 and 5,000 HTML tiers and the 708 SVG tier at both
pixel densities. Stage DOM counts gate at 2,000, including compact cards at 40%
and the fit overview. Hit-test p95 uses per-query batch means at 1,000
seeded screen points outside each interaction window. Each point repeats queries
until its batch spans at least 1 ms; the report includes actual call counts and
unrounded milliseconds per query. A separate 968-node remount trace gates its 16 ms main-thread
p95 and checks at most 200 admissions per frame across at least five frames.
Only `CI=true` selects runner budgets: the remount main-thread p95 limit is 24 ms,
and rAF intervals remain recorded without a failing assertion because software GL
can present at 30 fps. Every other budget and gate stays unchanged. The printed table,
JSON report and its attachment identify the `local` or `runner` budget set and
effective limits. The JSON retains reference limits; a `null` effective rAF limit
means it is reported only.
The 5,000 SVG stress tier remains reported. Browser traces
require the external browser runner; results depend on its GPU and rendering mode.
The overview comparison records main-thread work, worst frames, bitmap bytes and
worker presentation lag at 5,000 and `stress-50000` nodes. `test:browser` runs
Chromium only. Run `npm run test:browser:nightly --workspace=@openplanr/canvas`
for the Firefox cache check, using Playwright's installed Firefox by default.
`CANVAS_FIREFOX_NIGHTLY_PATH` optionally selects a nightly binary.

The browser runner defaults to software mode. For the local Metal comparison,
run `CANVAS_GPU_MODE=metal npm run bench:trace --workspace=@openplanr/canvas`.
CI rejects Metal mode; each result records the actual renderer string.
