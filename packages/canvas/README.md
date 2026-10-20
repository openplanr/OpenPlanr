# @openplanr/canvas

Framework-free camera, input, culling, focus and overview controller for HTML and SVG content. The package
is private and is not published. It has no runtime dependencies; React peers
remain optional.

Exports:

- `.`: `createCanvas`, `cameraFromScreenTranslate`, `cameraToScreenTranslate`,
  `drawCameraOverview`, `drawMinimap`, `minimapToWorld`, `CanvasFocusError`,
  and their camera, geometry, node, options, elements, events and controller types.
- `./react`: `CanvasProvider`, `CanvasStage`, `WorldNodes`, `OutlinePanel`,
  `ChromeProvider`, `useCanvas`, `useCamera`, `useChrome`, `useShortcut`,
  `formatShortcut`, `useReducedMotion`, `defaultChromeKeymap`, `ChromeRoot`,
  `MenuPill`, `Menu`, `MenuItem`, `FloatingToolbar`, `ToolbarItem`, `ToolbarMore`,
  `ActionPill`, `PrimaryAction`, `SidebarToggle`, `Sidebar`, `NavigationPanel`,
  `ZoomPill`, `HistoryPill`, `HelpButton`, `WelcomeHints`, `ToolbarHint`, and their prop,
  state and adapter types.
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

`zoomAt(factor)` zooms around the safe-area centre and announces the resulting
percentage through the 500 ms coalesced live region. Passing an explicit
`screenPoint` zooms silently, as wheel and pinch gestures do.

`setNodes` stores bounds for `fit('all' | 'selection' | ids, { padding, maxZoom })`
and `reveal(id, { mode: 'minimal' | 'center' })`. `setSelection` and `getSelection`
manage the selected IDs. Fit and reveal use the safe area. A 512 px spatial grid tracks incremental
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
override the defaults.

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

The stage uses one tab stop with roving node tabindex. `focusNode(id)` pins and
reveals a node, waits for its element, then resolves once DOM focus reaches it.
It rejects with `CanvasFocusError` (`code: 'unknown-node' | 'no-element'`) for
unknown IDs or when no element is available within two animation frames after
the reveal settles. `getFocus()` returns the focused ID or `null`; the `focus`
event emits each change. Unregister a focused element before removing it so
focus can wait on the stage until its replacement registers.

`getOutline()` lists every node by top edge, left edge and numeric ID, cached
until `setNodes`. Supply `outlineOrder(nodes)` to return every ID exactly once.
An outline button can await `focusNode(id)` then call `setSelection([id])`.
The engine announces its accessible name through one polite live region.

Arrows navigate by nearest centre within a 90-degree cone, breaking distance
ties by numeric ID. Override with `navigate(from, direction)`. Shift+Arrows pan
by a quarter of the safe-area size. Enter and Space select the focused node
on keydown; Space held on the stage remains available for pan. Escape deactivates
the active frame, then clears selection, then returns focus to the stage.
Home and End jump to the first and last outline entries. `+`/`=` and `-` zoom,
`0` resets to 100%, Shift+1 fits all and Shift+2 fits selection. Zoom commands,
navigation boundaries and outline jumps announce at most once per 500 ms;
wheel and pinch do not announce.

Set `keyboard.arrows: 'none'` to leave all arrows to the product. All keys ignore
editable focus, IME composition and Ctrl/Meta/Alt modifiers. A false
`shortcutsEnabled()` disables only single-character zoom and fit shortcuts.
A product coordinator may call `handleKey(event)`; it returns true and prevents
default only when consumed, and the same event is consumed once.

Event subscriptions return unsubscribe functions. Camera and active-frame
events coalesce and run after the frame's transform write. Selection changes
also emit `selection`. Invalid
inputs throw `TypeError` with the field and value.

## React bindings

Import bindings from `@openplanr/canvas/react` and structural styles from
`@openplanr/canvas/styles.css`. `CanvasProvider({ label, options?, nodes?, edges?,
controllerRef?, children? })` creates a controller after mounting and destroys
it on unmount. `label` and `options` configure that lifetime; remount the provider
to replace them. `controllerRef` accepts a callback or object ref and receives the
live controller, then `null` on cleanup. React applications pass geometry through
the provider's `nodes` prop and do not call `controller.setNodes` directly. The
provider keeps the latest ID-to-node map in a ref so geometry events can update
node positions without React state.

`CanvasStage({ className?, children? })` attaches the stage, world, edge SVG and
overview layers. Put `WorldNodes({ data, renderNode, nodeAttributes?, className? })` inside it;
`data` is a `ReadonlyMap`, and `renderNode(id, item, level)` receives `undefined`
when the map has no item for a mounted ID. Each wrapper registers with the
controller, stays memoized by item identity and level, and reads a new renderer
function through a ref. A changed renderer alone does not rerender existing
nodes. `nodeAttributes(id, item, level)` returns wrapper attributes such as
`role`, `aria-label`, `data-*` and `className`; it uses the same ref and memoization
rules. Its `className` combines with the shared wrapper `className`. Removed IDs
stop rendering as soon as the provider's nodes prop changes, before the core's
next mounted-set update. The product supplies node
content and its accessible name, including names appropriate to compact content.

`useCanvas()` returns the controller or `null` before its mount effect.
`useCamera(selector, isEqual = Object.is)` subscribes to selected camera values;
equal selections retain the previous snapshot. Neither `WorldNodes` nor chrome
subscribes to camera movement. Server rendering uses the initial camera
`{ x: 0, y: 0, zoom: 1 }` and creates no controller.

`OutlinePanel({ ids?, rowHeight, height, overscan = 3, renderRow, label,
onActivate? })` virtualizes a flat `listbox`; the outline has no hierarchy to
justify tree semantics. Rows expose their complete set size and one-based
position and use roving focus. ArrowUp/Down, Home/End and PageUp/Down move focus;
Enter or Space activates. IDs default to `getOutline()`. Activation invokes
`onActivate(id)` or awaits `focusNode(id)` before selecting it. Use plain content
in `renderRow(id, index)` so the option itself remains the focus target.

`ChromeProvider({ storage?, onStorageError?, keymap?, mobileBreakpoint = 720,
onePanelBreakpoint?, children? })` belongs above route content. `useChrome()`
returns its panel, safe-area, layout, hint, chrome-hidden and pending-inspector
state and registration/actions. `registerPanel(id, { side, role? })` declares a
left or right panel; `setPanelOpen`, `togglePanel` and `setPanelPinned` control
it. Panels start closed and unpinned. One-panel and mobile layouts close the
opposite side when opening a panel. Selection marks `inspectorPending` while
the sidebar remains closed.

Register measured surfaces with `registerSurface(id, edge, element, { persistent,
panelId?, zoom? })`. Only persistent surfaces affect the safe area; `panelId`
follows its panel's visibility and `zoom` keeps the zoom pill visible when chrome
is hidden. Safe-area coordinates describe page content when no canvas is mounted
and are forwarded to the current canvas otherwise. Registrations return cleanup
functions. `registerRegion(region, element, { panelId? }?)` adds a focus-cycle
region; `CanvasStage` registers the canvas region itself. F6 and Shift+F6 visit
skip link, menu, toolbar, action, canvas, sidebar, zoom, history and help, skipping
closed or absent regions.

`ChromeStorage` supplies `get(key)` and `set(key, value)`, synchronously or through
promises. Panel open/pinned state and dismissed hints persist through this
adapter. Failed reads use the closed default and report through
`onStorageError(error, { key, operation })`; absent that callback errors rethrow.
The exported `defaultChromeKeymap` binds Alt+BracketLeft to navigation/menu,
Alt+BracketRight to the sidebar, Alt+KeyZ to hidden chrome, F6 to the next region
and Shift+F6 to the previous region. Bindings match physical `event.code` plus
modifiers and ignore editable targets and IME composition. `useShortcut(action)`
returns the live binding; `formatShortcut(binding, platform?)` formats that same
binding for hints. `useReducedMotion()` tracks the media preference; the chrome
state's `transitionMs` provides the shared panel duration. Extend the default
keymap to customize bindings. `registerMenu(open)` registers the menu action
when no navigation panel exists and returns its cleanup function.

Put the floating slots inside `ChromeRoot`: `MenuPill` holds a `Menu` of
`MenuItem` actions and an optional `viewPicker`; `FloatingToolbar` holds
`ToolbarItem` controls and a `ToolbarMore` menu. Both item types take a
`shortcut` binding or chrome action name, so their visible hints and tooltips
follow the provider keymap. Products bind their own tool shortcuts from the same
binding objects they pass to the controls. `ActionPill` accepts one
`PrimaryAction` and a `SidebarToggle`; a second primary action throws.

`Sidebar({ inspector?, outline? })` supplies Inspector and Outline tabs, pin and
close controls. `NavigationPanel` supplies an optional left panel. Panels begin
closed and unpinned; selecting a node marks the sidebar toggle without opening
it. Enter on a selected node or a product Inspect action opens the sidebar.
Escape and an empty-canvas click close unpinned panels; pinned panels remain.
Closed panels are inert. Menus close on Escape, a canvas click or another menu
opening, and never contribute to the safe area.

`ZoomPill` and `HistoryPill({ onUndo, onRedo, canUndo?, canRedo? })` render only
with a registered canvas. `HelpButton` accepts `onClick`.
`WelcomeHints({ actions })` presents real product actions while the canvas has
no nodes and anchors its labels to the measured menu and toolbar.
`ToolbarHint({ id, children })` remembers dismissal through the storage adapter.
Below the mobile breakpoint the menu, zoom and action pills share one top row,
with 16 px side gutters plus safe-area insets and a 12 px gap. CSS Grid positions
zoom beside the menu's computed width and keeps actions at the right edge.
The row reserves one top safe-area band ending 12 px below the pills. Slots are
48 px tall with at least 44 px touch targets. Below 360 px, including 320 px,
zoom compacts to minus and plus buttons; its percentage also hides whenever its
grid track cannot fit the text. Wide view-picker labels truncate as needed.
The toolbar stays at the bottom centre, panels become exclusive bottom sheets,
and secondary controls move into the menu.
Structural tokens in `styles.css` provide shared spacing and sizes;
products theme the neutral tokens, `--canvas-chrome-accent` and
`--canvas-chrome-focus`. Motion uses transform and opacity and respects reduced
motion preferences.

The React bench at `bench/react.html?chrome=1` demonstrates every slot; add
`empty=1` to try welcome actions. The default page and trace scenarios keep their
existing chrome-free layout. `window.chromeBench` exposes keymap and tool-binding
setters, node creation, state inspection and storage diagnostics for browser
checks; `storageError=1` exercises the product error callback.

The React bench at `bench/react.html` uses the same fixtures and trace interface
as the vanilla page. Its preloaded React DevTools hook counts production commits
through `onCommitFiberRoot`, exposed as `window.reactCommits`.
React trace rows report commits, mount and level events, and commit counts for
camera frames without mount or level changes.

Run `npm test --workspace=@openplanr/canvas`, `npm run test:browser
--workspace=@openplanr/canvas`, or `npm run bench:trace
--workspace=@openplanr/canvas`. The production Vite bench accepts `fixture`,
`world`, `pointerMode`, `zoom`, `frame=1`, `frames=15` and `overviewRenderer` query parameters.
Use `outline=1` for the visually hidden outline list.
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
Only `CI=true` selects runner budgets: remount main-thread p95 and rAF intervals
remain recorded without failing assertions because software GL has noisy remount
timings and can present at 30 fps. Local remounts keep the 16 ms limit enforced.
Every other budget and gate stays unchanged. The printed table,
JSON report and its attachment identify the `local` or `runner` budget set and
effective limits. Runner remounts show `reported (reference 16)` in the table,
JSON report and attachment. The JSON retains reference limits; a `null` effective
remount or rAF limit means it is reported only.
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
