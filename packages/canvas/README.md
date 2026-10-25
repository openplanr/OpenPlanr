# @openplanr/canvas

Framework-free camera, input, culling, focus and overview controller for HTML and SVG content. The package
is private and is not published. It has no runtime dependencies; React peers
remain optional.

## Workspace installation

The package remains private at `0.0.0` and is not yet published to npm. Existing
workspace consumers resolve it through the root npm workspace installation:

```bash
npm ci
npm run build -w @openplanr/canvas
```

Use Node.js 22.13 or later. The core has no runtime dependencies. React consumers
supply `react` and `react-dom` compatible with the optional `^19.2.0` peers.
Import the core from `@openplanr/canvas`, React bindings from
`@openplanr/canvas/react`, and CSS once from `@openplanr/canvas/styles.css`.
Give the stage's container an explicit height; the structural stage fills it.

## Entry points

Each table lists both runtime values and TypeScript types exported by that entry.

### `.` exports

| Export | Purpose |
| --- | --- |
| `createCanvas` | Creates a detached controller from `CanvasOptions`. |
| `cameraFromScreenTranslate` | Converts screen translation and scale to a camera. |
| `cameraToScreenTranslate` | Converts a camera to screen translation and scale. |
| `drawCameraOverview` | Draws an overview of nodes for a camera and viewport. |
| `drawMinimap` | Draws a fitted minimap and returns its coordinate transform. |
| `minimapToWorld` | Converts a minimap point to world coordinates. |
| `CanvasFocusError` | Focus failure with an `unknown-node` or `no-element` code. |
| `Breakpoint` | Named minimum stage width for responsive frame budgets. |
| `Camera` | World origin and zoom: `{ x, y, zoom }`. |
| `CanvasController` | Controller methods for lifetime, geometry, camera, input, focus and events. |
| `CanvasEdge` | Edge endpoints, style and optional routed world points. |
| `CanvasElements` | Stage, HTML world and optional overlays, edges and overview elements. |
| `CanvasEvents` | Typed camera, mount, geometry, level, selection, focus, breakpoint, active-frame and diagnostic payloads. |
| `CanvasLevel` | Rendering level: `dom`, `compact` or `overview`. |
| `CanvasNode` | Node ID, world bounds and optional kind/frame marker. |
| `CanvasOptions` | Label and optional camera, culling, rendering, input and navigation configuration. |
| `ChromeSurface` | Measured open chrome surface and its occupied edge. |
| `Diagnostic` | Geometry or endpoint problem with a code, ID and reason. |
| `Direction` | An up, down, left or right navigation direction. |
| `MinimapTransform` | Scale and offsets mapping world coordinates into a minimap. |
| `NodeId` | String node identifier. |
| `OverviewMetrics` | Cache bytes, redraw count and worker presentation measurements. |
| `OverviewStyle` | Callback returning a node overview fill and stroke. |
| `Point` | Readonly `{ x, y }` coordinate. |
| `Rect` | Readonly `{ x, y, width, height }` rectangle. |
| `WorldElement` | HTML element transformed as a world layer. |

### `./react` exports

| Export | Purpose |
| --- | --- |
| `CanvasProvider` | Owns a controller lifetime and synchronizes React node and edge props. |
| `CanvasStage` | Attaches the stage, HTML world, edge SVG and overview layers. |
| `WorldNodes` | Renders the mounted ID set with memoized product content. |
| `OutlinePanel` | Virtualized flat listbox for reaching every node. |
| `ChromeProvider` | Owns panel state, measured safe areas, storage and chrome shortcuts. |
| `useCanvas` | Returns the mounted controller or `null`. |
| `useCamera` | Subscribes to a selected camera value with optional equality comparison. |
| `useChrome` | Returns chrome state and registration/actions; requires `ChromeProvider`. |
| `useShortcut` | Returns a chrome action’s current key binding. |
| `formatShortcut` | Formats a key binding for the current or supplied platform. |
| `useReducedMotion` | Subscribes to the reduced-motion media preference. |
| `defaultChromeKeymap` | Default menu, sidebar, hide-chrome and focus-region bindings. |
| `ChromeRoot` | Full-window chrome container. |
| `MenuPill` | Menu slot with an optional view picker. |
| `Menu` | Accessible menu of product actions. |
| `MenuItem` | Menu action with optional shortcut hint. |
| `FloatingToolbar` | Floating tool slot. |
| `ToolbarItem` | Tool control with optional shortcut hint. |
| `ToolbarMore` | Overflow menu for secondary toolbar controls. |
| `ActionPill` | Primary action and sidebar toggle slot. |
| `PrimaryAction` | Single primary product action. |
| `SidebarToggle` | Inspector/outline panel toggle with selection indication. |
| `Sidebar` | Inspector and outline panel with pin and close controls. |
| `NavigationPanel` | Optional left navigation panel. |
| `ZoomPill` | Camera zoom controls shown when a canvas is registered. |
| `HistoryPill` | Product undo/redo controls shown when a canvas is registered. |
| `HelpButton` | Help action slot. |
| `WelcomeHints` | Empty-canvas product actions with anchored labels. |
| `ToolbarHint` | Dismissible toolbar hint persisted through chrome storage. |
| `ChromeAction` | Named menu, sidebar, visibility or focus-cycle action. |
| `ChromeKeymap` | Binding for each chrome action. |
| `ChromePanelOptions` | Panel side and optional navigation/sidebar role. |
| `ChromePanelState` | Panel open and pinned flags. |
| `ChromeRegion` | Named focus-cycle region. |
| `ChromeRegionOptions` | Optional panel association for a focus region. |
| `ChromeShortcut` | Physical key code and optional modifier flags. |
| `ChromeState` | Chrome snapshots and panel, surface, region and hint actions. |
| `ChromeStorage` | Synchronous or asynchronous key/value storage adapter. |
| `ChromeStorageErrorContext` | Storage key and failed get/set operation. |
| `ChromeSurfaceOptions` | Persistent safe-area participation, panel association and zoom visibility. |
| `ActionPillProps` | Props accepted by `ActionPill`. |
| `ChromeRootProps` | Props accepted by `ChromeRoot`. |
| `FloatingToolbarProps` | Props accepted by `FloatingToolbar`. |
| `HelpButtonProps` | Props accepted by `HelpButton`. |
| `HistoryPillProps` | Props accepted by `HistoryPill`. |
| `MenuItemProps` | Props accepted by `MenuItem`. |
| `MenuPillProps` | Props accepted by `MenuPill`. |
| `MenuProps` | Props accepted by `Menu`. |
| `NavigationPanelProps` | Props accepted by `NavigationPanel`. |
| `PrimaryActionProps` | Props accepted by `PrimaryAction`. |
| `SidebarProps` | Props accepted by `Sidebar`. |
| `SidebarToggleProps` | Props accepted by `SidebarToggle`. |
| `ToolbarHintProps` | Props accepted by `ToolbarHint`. |
| `ToolbarItemProps` | Props accepted by `ToolbarItem`. |
| `ToolbarMoreProps` | Props accepted by `ToolbarMore`. |
| `WelcomeHintsProps` | Props accepted by `WelcomeHints`. |
| `ZoomPillProps` | Props accepted by `ZoomPill`. |
| `ChromeProviderProps` | Props accepted by `ChromeProvider`. |
| `OutlinePanelProps` | Props accepted by `OutlinePanel`. |
| `CanvasProviderProps` | Props accepted by `CanvasProvider`. |
| `CanvasStageProps` | Props accepted by `CanvasStage`. |
| `WorldNodesProps` | Props accepted by `WorldNodes`. |

### `./testing` exports

| Export | Purpose |
| --- | --- |
| `generateLayeredGraph` | Seeded 708- or 5,000-node HTML graph fixture. |
| `generateSvgDiagram` | Seeded 708- or 5,000-node SVG diagram fixture. |
| `percentile95` | Computes p95 of nonempty finite nonnegative samples. |
| `rendererFrameWork` | Measures renderer main-thread work between trace frame marks. |
| `classifyLayoutShift` | Classifies a shift against input-window policy. |
| `aggregateLayoutShifts` | Aggregates measured shifts with input-phase evidence. |
| `CANVAS_TRACE_BUDGETS` | Shared reference limits and measurement sample counts. |
| `evaluateCanvasTrace` | Validates evidence and returns failures, reports and pending coverage. |
| `toClockResolution` | Rounds frame intervals to 0.1 ms browser clock resolution. |
| `traceBudgetPolicy` | Selects effective local or runner trace limits. |
| `traceOwnership` | Identifies gated HTML/708 SVG tiers and reported SVG stress tiers. |
| `domBudgetPolicy` | Selects gated DOM counts or report-only remount/stress measurements. |
| `CanvasFixture` | Fixture nodes, edges and aggregate world bounds. |
| `FixtureEdge` | Fixture edge with endpoints and world route points. |
| `FixtureNode` | Fixture node with title, rank and world bounds. |
| `CanvasChromeMeasurement` | Chrome-toggle layout-shift evidence and camera/stage snapshots. |
| `CanvasChromeSnapshot` | Camera and stage rectangle at a chrome measurement point. |
| `CanvasHitTestMeasurement` | Fixture identity and hit-test probe. |
| `CanvasHitTestProbe` | Hit-test p95, sample/query counts and minimum sample duration. |
| `CanvasLodMeasurement` | LOD band transitions, observed levels and blank/double-layer counts. |
| `CanvasPinMeasurement` | Pinned-node count, DOM count and dropped pins. |
| `CanvasTraceEvaluation` | Evaluation identity, failures, reported metrics, pending sections and pass flag. |
| `CanvasTraceIdentity` | Fixture, renderer, world, node tier and device pixel ratio. |
| `CanvasTraceMeasurement` | Scenario runs and first-frame load trials. |
| `CanvasTraceResults` | Browser, budget set and optional trace, hit-test, chrome, LOD and pin evidence. |
| `CanvasTraceRun` | One interaction run’s timing, DOM, hit-test and optional React measurements. |
| `LayoutShift` | Shift value, timing, input phase and source geometry. |
| `LayoutShiftPolicy` | Input phase and optional input-window duration for shift classification. |
| `LayoutShiftRect` | Full rectangle coordinates recorded for a shifted source. |
| `LayoutShiftReport` | Phases, input actions and measured shifts. |
| `RendererTraceEvent` | Chromium trace event fields used by renderer work measurement. |
| `RendererTraceMarks` | Optional frame and interaction boundary mark names. |

### `./styles.css`

Import `@openplanr/canvas/styles.css` for structural stage/world/overview/edge
styles, floating chrome, responsive panels and the tokens documented below.
This stylesheet exports no JavaScript values or TypeScript types.

## Core API

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

Register persistent chrome with `setChrome({ id, edge, rect, open })`, remove it
with `removeChrome(id)`, and read the remaining stage rectangle with
`getSafeArea()`. Rectangles use stage-relative screen coordinates; camera reveal
operations reserve the occupied edges.

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

## Keyboard and accessibility

| Input or contract | Behavior |
| --- | --- |
| Arrows | Navigate by nearest centre within a 90-degree cone, breaking distance ties by numeric ID; `navigate(from, direction)` can override it. |
| Shift+Arrows | Pan by a quarter of the safe-area size. |
| Enter / Space | Select the focused node on keydown. Space held on the stage remains available for pan. |
| Escape | Deactivate an active frame, then clear selection, then return focus to the stage. |
| Home / End | Focus the first / last outline entry. |
| `+` / `=` / `-` | Zoom in / out by a factor of 1.25 around the safe-area centre. |
| `0` | Reset zoom to 100%. |
| Shift+1 / Shift+2 | Fit all nodes / the selection into the safe area. |
| Ctrl/Meta/Alt with a stage key | Leave the key to the product/browser; browser zoom shortcuts are not intercepted. |
| Editable focus / IME composition | Ignore engine shortcuts. |
| `keyboard.arrows: 'none'` | Leave all arrows, including shifted arrows, to the product. |
| `shortcutsEnabled()` returns false | Disable only single-character zoom, reset and fit shortcuts. |
| Product key coordinator | `handleKey(event)` returns true and prevents default only when consumed; the same event is consumed once. |
| Stage semantics | Named `group` with `aria-roledescription="canvas"`, one tab stop and roving node tabindex. Products provide accessible node names. |
| Offscreen nodes | `focusNode` pins, reveals and waits for the node element; `getOutline()` reaches every node. |
| Announcements | One polite live region; zoom, navigation boundaries and outline jumps coalesce at most once per 500 ms. Wheel and pinch remain silent. |
| Frame interaction | Host-side Done control and outside click allow leaving an active frame without a cross-origin keyboard bridge. |
| Reduced motion | Camera animations and chrome transitions respect the media preference; `motion: 'none'` also disables camera animation. |
| Forced colours | Overview nodes use `CanvasText`, selection/focus use `Highlight`, and chrome defaults use system colours. Products supply accessible DOM node styles. |
| Outline listbox | ArrowUp/Down, Home/End and PageUp/Down move focus; Enter/Space activates. Rows report full set size and one-based position. |
| F6 / Shift+F6 with `ChromeProvider` | Visit registered skip-link, menu, toolbar, action, canvas, sidebar, zoom, history and help regions; skip absent or closed regions. |
| Alt+[ / Alt+] / Alt+Z with the default chrome keymap | Toggle navigation/menu, sidebar or chrome visibility using physical key codes. |

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

## Verification and budgets

After building, `npm test -w @openplanr/canvas` checks README exports against the
built declarations. `npm run test:packed -w @openplanr/canvas` builds and packs the
package, installs it in an isolated Vite React app and checks rendering, pan and
zoom in Chromium. The packed check needs network access and a Playwright browser;
it is excluded from the default unit suite.

Run `npm test --workspace=@openplanr/canvas`, `npm run test:browser
--workspace=@openplanr/canvas`, or `npm run bench:trace
--workspace=@openplanr/canvas`. The production Vite bench accepts `fixture`,
`world`, `pointerMode`, `zoom`, `frame=1`, `frames=15` and `overviewRenderer` query parameters.
Use `outline=1` for the visually hidden outline list.
It renders through mount and geometry events and shows the mounted count. Trace results are written to
`test-results/bench-trace-${gpuMode}.json`; the measured reference and runner results appear
together in its report. Each scenario records three runs and reports median
p95s with all raw results. A discarded warm-up precedes the 708-node interaction
runs. Every scenario and raw trace run includes the WebGL renderer string.
Traced runs and the untraced budgets bench are reserved for nightly verification
and release PRs. Routine changes use the unit and functional browser suites.
The trace script remains available for reproducing those runs locally.

The following limits come from `CANVAS_TRACE_BUDGETS` and
`traceBudgetPolicy`. Only `CI=true` selects runner limits in the trace harness;
all other environments use the local set. Values below are maxima unless a
sample count or exact count is stated.

| Metric | Local reference | `CI=true` runner |
| --- | --- | --- |
| Chromium renderer main-thread p95, vanilla HTML, 708 / 5,000 nodes | 6 / 8 ms | Same |
| Chromium renderer main-thread p95, React HTML, 708 / 5,000 nodes | 8 / 10 ms | Same |
| Chromium renderer main-thread p95, SVG, 708 / 5,000 nodes | 8 / 12 ms | Same; 5,000 SVG is reported only |
| Remount renderer main-thread p95 | 16 ms | Reported only (16 ms reference) |
| Chromium rAF interval p95 | 16.8 ms | Reported only (16.8 ms reference) |
| WebKit rAF interval p95 | 19 ms | Reported only (19 ms reference) |
| WebKit 40% pan worst frame | 33 ms | Same |
| Firefox 100% pan frame p95 | 17 ms | Same |
| Firefox fit pan frame p95, 708 / 5,000 nodes | 20 / 25 ms | Same |
| Long tasks over 50 ms | 0 | Same |
| Stage DOM nodes | 2,000 | Same; remount DOM count is reported only |
| First fixture frame p50 | 150 ms across exactly 5 loads | 250 ms across exactly 5 loads |
| Hit-test p95 | Greater than 0 and at most 0.1 ms | Same |
| Hit-test sampling | Exactly 1,000 points, at least 1,000 queries, at least 1 ms per sample batch | Same |
| Chrome toggles / admitted layout shift | Exactly 16 toggles / 0 admitted CLS | Same |
| LOD switches per band | Exactly 20 | Same |
| Blank frames / double-layer frames | 0 / 0 | Same |
| Dropped pins | 0, with 50- and 500-pin tiers | Same |
| React commits on pure camera frames | 0 | Same |

HTML at both node tiers and SVG at 708 nodes are gated. The 5,000-node SVG stress
tier reports trace timings without gating them. Frame intervals are rounded to
0.1 ms before comparison. Local runs keep every reference budget unchanged.
All four scenarios gate main-thread, rAF, long-task, first-frame
and hit-test budgets for the 708 and 5,000 HTML tiers and the 708 SVG tier at both
pixel densities. Stage DOM counts gate at 2,000, including compact cards at 40%
and the fit overview. Hit-test p95 uses per-query batch means at 1,000
seeded screen points outside each interaction window. Each point repeats queries
until its batch spans at least 1 ms; the report includes actual call counts and
unrounded milliseconds per query. A separate 968-node remount trace gates its 16 ms main-thread
p95 and checks at most 200 admissions per frame across at least five frames.
Only `CI=true` selects runner budgets: remount main-thread p95 and rAF intervals
remain recorded without failing assertions because software GL has noisy remount
timings and can present at 30 fps. The first fixture frame p50 gates at 250 ms on
the runner, whose cold software-GL page loads measure about three times the local
time, and at 150 ms locally. Local remounts keep the 16 ms limit enforced.
Every other budget and gate stays unchanged. The printed table,
JSON report and its attachment identify the `local` or `runner` budget set and
effective limits. Runner remounts show `reported (reference 16)` and runner first
frames `250 (reference 150)` in the table,
JSON report and attachment. The JSON retains reference limits; a `null` effective
remount or rAF limit means it is reported only.
The 5,000 SVG stress tier remains reported. Browser traces
require the external browser runner; results depend on its GPU and rendering mode.
The overview comparison records main-thread work, worst frames, bitmap bytes and
worker presentation lag at 5,000 and `stress-50000` nodes. `test:browser` runs
Chromium only. Run `npm run test:browser:nightly --workspace=@openplanr/canvas`
for the Firefox cache check, using Playwright's installed Firefox by default.
`CANVAS_FIREFOX_NIGHTLY_PATH` optionally selects a nightly binary.

Run `npm run bench:trace:cross-browser --workspace=@openplanr/canvas` for the
WebKit and stock Firefox trace suites. WebKit covers HTML fixtures
with 708 and 5,000 nodes in vanilla and React at DPR 2 and 1, exercising pan at
100%, pan at 40%, fit and zoom. Firefox uses the same eight fixture, binding and
DPR combinations with pan at 100% and fit. The separate `firefox` project keeps
the optional nightly binary for the cache check; `firefox-trace` uses
Playwright's installed Firefox.

These browsers reuse the benches' rAF intervals, bounded by each interaction's
own phase and frame marks. `PerformanceObserver.supportedEntryTypes` determines
whether long-task and layout-shift observations are available; unavailable
metrics are reported as `unsupported`. CDP main-thread work is `unsupported`
outside Chromium. First-frame timing and DOM counts remain supported.

The release-candidate job uses `CI=true`. It gates long tasks where supported,
stage DOM counts, first-frame p50 (250 ms) and hit-test budgets, plus React
pure-camera commit checks. As in Chromium, the runner only reports interaction
rAF p95 and worst-frame limits; local runs enforce the existing browser limits.
Frame timings must still be numeric; missing or `unsupported` timing is invalid.

| Measurement | Chromium | WebKit | Firefox |
| --- | --- | --- | --- |
| rAF interval p95 | Bench intervals | Bench intervals | Bench intervals |
| Worst frame | CDP renderer work | Bench intervals | Bench intervals |
| Interaction and engine frame marks | Supported | Supported | Supported |
| First-frame timing and stage DOM count | Supported | Supported | Supported |
| CDP main-thread work | Supported | `unsupported` | `unsupported` |
| Long-task observations | Runtime support required by CDP suite | Runtime support check | Runtime support check |
| Layout-shift observations | Runtime support check | Runtime support check | Runtime support check |

Cross-browser results use `test-results/bench-trace-webkit-${gpuMode}.json`,
and `test-results/bench-trace-firefox-${gpuMode}.json`. To run the optional
untraced budget checks in those projects, use
`npm exec --workspace=@openplanr/canvas -- playwright test --project=webkit --project=firefox-trace tests/browser/budgets.spec.ts`.
Those checks write `test-results/canvas-budgets-webkit-${gpuMode}.json` and
`test-results/canvas-budgets-firefox-${gpuMode}.json`. Chromium keeps its existing
filenames. The `canvas-cross-browser-traces` job in `nightly.yml` adds only
the extra engine trace rows and runs only on
`workflow_dispatch`, including release-candidate dispatches and manual runs.
Scheduled runs and ordinary pull requests do not run this lane. The existing
Chromium `canvas-traces` job already supplies the second edge density and
untraced budget bench on dispatch.

The browser runner defaults to software mode. For the local Metal comparison,
run `CANVAS_GPU_MODE=metal npm run bench:trace --workspace=@openplanr/canvas`.
CI rejects Metal mode; each result records the actual renderer string.

`evaluateCanvasTrace(results, tier)` applies shared budgets at both 708 and 5,000
nodes. It returns failures, reported metrics and pending sections; compositor
dropped frames at fit remain pending. Missing sections are pending and malformed
fields throw `TypeError`. `aggregateLayoutShifts(evidence, { inputPhase })` counts
all canvas shifts with `inputPhase: () => false`; consumers can classify input
phases with an optional `inputWindowMs` (500 ms by default).
The untraced `tests/browser/budgets.spec.ts` covers enabled fixtures, renderers
and DPRs with hit tests, sixteen chrome toggles, both LOD bands and 50/500 pins.
Its report is `test-results/canvas-budgets-${gpuMode}.json`. Both reports include
browser/version, GPU mode, renderer strings, build commit and package version.
Set `CANVAS_SECOND_DENSITY=1` to include HTML fixtures `708-477` and `5000-8499`
in both benches; both reports record `secondDensity`.

## Theming

The stylesheet defines these defaults on `:root`. Override them on `:root` or an
appropriate ancestor of the stage/chrome. Products supply their node, edge and
overview colours; these variables theme structural layers and chrome.

| CSS variable | Default | Purpose |
| --- | --- | --- |
| `--canvas-z-stage` | `0` | Stage stacking level. |
| `--canvas-z-world-overlays` | `5` | World overlay stacking token. |
| `--canvas-z-screen-overlays` | `10` | Screen overlay stacking token. |
| `--canvas-z-chrome` | `20` | Floating chrome stacking level. |
| `--canvas-z-popovers` | `30` | Popover and mobile panel stacking level. |
| `--canvas-z-toasts` | `40` | Toast stacking token. |
| `--canvas-z-modals` | `50` | Modal stacking token. |
| `--canvas-chrome-inset` | `12px` | Chrome distance from viewport edges. |
| `--canvas-chrome-gap` | `12px` | Spacing between chrome surfaces. |
| `--canvas-chrome-pill-height` | `40px` | Desktop pill height. |
| `--canvas-chrome-toolbar-height` | `44px` | Desktop toolbar height. |
| `--canvas-chrome-help-size` | `40px` | Desktop help button size. |
| `--canvas-chrome-zoom-width` | `144px` | Desktop zoom pill width. |
| `--canvas-chrome-sidebar-width` | `312px` | Default sidebar width. |
| `--canvas-chrome-navigation-width` | `264px` | Default navigation panel width. |
| `--canvas-chrome-panel-inset` | `64px` | Desktop panel top/bottom inset. |
| `--canvas-chrome-transition` | `180ms` | Panel transform/opacity transition duration. |
| `--canvas-chrome-background` | `Canvas` | Surface background. |
| `--canvas-chrome-foreground` | `CanvasText` | Main text colour. |
| `--canvas-chrome-muted` | `CanvasText` | Disabled control colour. |
| `--canvas-chrome-border` | `ButtonBorder` | Surface border colour. |
| `--canvas-chrome-hover` | `ButtonFace` | Hover background. |
| `--canvas-chrome-accent` | `ButtonText` | Primary action background. |
| `--canvas-chrome-on-accent` | `Canvas` | Primary action foreground. |
| `--canvas-chrome-focus` | `Highlight` | Focus-ring colour. |
| `--canvas-chrome-shadow` | `0 2px 12px rgb(0 0 0 / 12%)` | Surface shadow. |

`--canvas-chrome-panel-width` is an optional per-panel override consumed by the
stylesheet; it has no declared default and falls back to the sidebar or
navigation width. Mobile layout uses its own 48 px slot height and bottom-sheet
geometry. See the React binding section for its responsive behavior.
