# @openplanr/canvas

Framework-free camera, input and culling controller for HTML and SVG content. The package
is private and is not published. It has no runtime dependencies; React peers
remain optional.

Exports:

- `.`: `createCanvas`, `cameraFromScreenTranslate`, `cameraToScreenTranslate`,
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
override the defaults. Overview, safe-area chrome and the outline remain pending.
At settled fit zoom the region can include the entire graph; the stage DOM budget
still needs the pending overview layer. The trace gate retains that budget.

`setEdges` supplies edges with `id`, `from`, `to`, `style`, and optional world
`points`. Routes intersecting the mounted region draw as one path per style,
even when both endpoints are culled. Flat routes receive a one-pixel viewport
extent so their stroke remains visible. Unknown endpoints appear in
`getDiagnostics()` and the `diagnostics` event; `strict: true` throws instead.

`setPointerMode('pan' | 'none')` controls empty-stage drag. Wheel pans; Ctrl/Cmd
plus wheel and pinch zoom at the pointer. Space on the focused stage and the
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
`world`, `pointerMode`, `zoom`, `frame=1` and `frames=15` query parameters.
It renders through mount and geometry events and shows the mounted count. Trace results are written to
`test-results/bench-trace.json`; the measured reference and runner results appear
together in its report. Each scenario records three runs and reports median
p95s with all raw results. A discarded warm-up precedes the 708-node interaction
runs. Every scenario and raw trace run includes the WebGL renderer string.
All four scenarios gate the unchanged main-thread, rAF, long-task, first-frame
and hit-test budgets for the 708 and 5,000 HTML tiers and the 708 SVG tier at both
pixel densities. Fit DOM counts are reported as owned by the pending overview.
At 40%, HTML DOM counts retain the 2,000 reference budget and are reported as
"budget conflict, owner decision pending", with a 2,100 regression ceiling.
Other DOM gates remain at 2,000. Hit-test p95 uses per-query batch means at 1,000
seeded screen points outside each interaction window. Each point repeats queries
until its batch spans at least 1 ms; the report includes actual call counts and
unrounded milliseconds per query. A separate 968-node remount trace gates its 16 ms main-thread
p95 and checks at most 200 admissions per frame across at least five frames.
The 5,000 SVG stress tier remains reported. Browser traces
require the external browser runner; results depend on its GPU and rendering mode.

The browser runner defaults to software mode. For the local Metal comparison,
run `CANVAS_GPU_MODE=metal npm run bench:trace --workspace=@openplanr/canvas`.
CI rejects Metal mode; each result records the actual renderer string.
