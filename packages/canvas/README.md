# @openplanr/canvas

Framework-free camera and input controller for HTML and SVG worlds. The package
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
destroy throw; returned unsubscribe functions remain safe. The world is an HTML
element or an SVG group; overlays follow the same camera. Consumers render nodes and mark frame wrappers with
`data-canvas-node-id` matching a node with `frame: true`.

Camera coordinates `{ x, y, zoom }` identify the world point at the stage's top
left. `panBy` advances this point by screen pixels divided by zoom. Use
`getCamera`, `setCamera`, `zoomAt`, `worldToScreen` and `screenToWorld` for camera
operations. The translation converters preserve Studio's `{ x, y, scale }` store.
Default zoom limits are 0.04 and 4. Optional padded world bounds constrain pan.
Animated `setCamera` moves take at most 200 ms and honor reduced motion and
`motion: 'none'`.

`setNodes` stores bounds for `fit('all' | 'selection' | ids, { padding, maxZoom })`
and `reveal(id, { mode: 'minimal' | 'center' })`. `setSelection` and `getSelection`
manage the selected IDs. Fit and reveal use the full stage. Culling, rendering,
node focus, outline, safe-area chrome, edges and overview are not implemented.

`setPointerMode('pan' | 'none')` controls empty-stage drag. Wheel pans; Ctrl/Cmd
plus wheel and pinch zoom at the pointer. Space on the focused stage and the
middle button pan in either mode. Frame previews are shielded until
`setActiveFrame(id)` and while moving. The host Done button, outside click,
`setActiveFrame(null)` or `deactivateFrame()` leave frame interaction.
`getActiveFrame()` returns its ID.

The stage handles `+`/`=` and `-` for zoom, `0` for 100%, Shift+1 to fit all,
Shift+2 to fit selection, and Shift+Arrows to pan by a quarter stage. Set
`keyboard.arrows: 'none'` to leave all arrows to the product. Shortcuts ignore
editable focus, IME composition and a false `shortcutsEnabled()` result. Browser
page zoom keys pass through. A product coordinator may call `handleKey(event)`;
it returns true only when consumed, and the same event is consumed once.

`on('camera', listener)` and `on('active-frame', listener)` return unsubscribe
functions. Events coalesce and run after the frame's transform write. Invalid
inputs throw `TypeError` with the field and value.

Run `npm test --workspace=@openplanr/canvas`, `npm run test:browser
--workspace=@openplanr/canvas`, or `npm run bench:trace
--workspace=@openplanr/canvas`. The production Vite bench accepts `fixture`,
`world`, `pointerMode` and `zoom` query parameters. Trace results are written to
`test-results/bench-trace.json`; the measured reference and runner results appear
together in its report. Each scenario records three runs and reports median
p95s with all raw results. A discarded warm-up precedes the 708-node interaction
runs. Only the 708-node HTML pan at 100% gates budgets at both pixel densities;
all other cases are reported for culling or SVG-tier work.
