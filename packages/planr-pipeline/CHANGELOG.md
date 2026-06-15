# Changelog

All notable changes to this plugin are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/) — with the caveat that pre-1.0 releases may contain breaking changes in minor bumps.

> **Note:** Plugin renamed from `openplanr-pipeline` to `planr-pipeline` in v0.7.0 (brand convergence on the `planr` CLI binary). Entries from v0.6.0 and earlier reference the old name verbatim.

## [0.21.3] — 2026-06-15

### Fixed — board rendered HTML/canvas artifacts as images (broken thumbnail + blank compare)

The board rendered artifacts as `<img>` in two places that never checked the
type — the **Versions** thumbnail and the **A/B compare** view. For an HTML/canvas
artifact (e.g. `canvas.html` in a design review) the browser can't load the file
as an image, so the version thumbnail showed a broken icon and — worse —
entering A/B compare replaced the working artifact with a blank frame and broken
`base`/`compare` images, making the design look missing. (The artifact itself was
always intact; the normal view already used an `<iframe>`.)

- **Version thumbnail** now type-guards the file like the Variants rail: SVG →
  `<object>`, raster (png/jpg/webp) → `<img>`, else (html/canvas) → `◈`.
- **A/B compare** is now type-aware: image/SVG keep the clip-slider; HTML/canvas
  versions render as two live `<iframe>`s side by side (A | B) — never a broken
  `<img>`, and actually useful for comparing two design iterations.

### Fixed — `/plan` now schema-validates its output (no more silently-invalid tasks)

The specification-agent could emit a frontmatter value outside the schema — it wrote
`status: "ready"`, which isn't in the task enum (`pending | in-progress | done |
blocked`). Nothing validated generated artifacts at decomposition time, so `/ship` later
partitioned its queue by status, matched nothing, and reported "nothing to dispatch": a
green gate you couldn't trust.

- **`/plan` schema gate (Phase C)** now runs the shipped validator
  (`conformance/runner.mjs --validate-schema <dir>`) over the spec + every `stories/US-*.md`
  + every `tasks/T-*.md` after decomposition, and **hard-fails** on any violation, naming
  the offending file + field. Deterministic — not the LLM checking itself.
- **specification-agent** now inlines the `status` enum and requires newly decomposed
  tasks to be `status: "pending"` (no `ready`/`todo`/`open` synonyms), plus the
  `type`↔`agent` correlation.

## [0.21.2] — 2026-06-15

### Fixed — the board daemon now restarts onto new code (capability-URL fix lands)

v0.21.1 stopped the board index from enumerating boards, but the daemon is a
long-lived process and `ensureDaemon` reused any running one with no version
check — so a daemon started before the update kept serving the old enumerating
index, and the registry kept accumulating every project's boards.

- **Version-aware restart** — `/health` now reports a `DAEMON_VERSION`. When a
  running daemon reports a different (or absent) version, `ensureDaemon` stops it
  and spawns a fresh one, so behaviour changes actually take effect after an
  update instead of waiting for a manual kill or reboot.
- **Registry pruning on startup** — drops boards whose dir vanished and legacy
  entries that predate capability tokens (bare slug, no `--<token>`), so the
  shared registry can no longer accumulate — or serve — other projects' boards.

## [0.21.1] — 2026-06-15

### Fixed — design boards are scoped to the design under review (capability URLs)

The board daemon is one shared, persistent server per machine. Its root `/`
enumerated **every** board from **every** project, and boards were reachable at a
guessable `/boards/<slug>/` — so a review URL (or a screenshot of the index)
leaked other projects' names.

- **Capability URL** — each board now registers under `<slug>--<token>`, where
  `token` is an unguessable 96-bit value. The URL printed by `/design` /
  `/design-loop` / `/design-review` is the credential; the bare slug 404s.
- **No enumeration** — `GET /` no longer lists boards; it points you to the exact
  URL your command printed.
- The token is persisted in the daemon state dir (under `planrHome`), keyed by
  the board dir, so the URL is stable across daemon restarts and never lands in a
  project's git tree.

## [0.21.0] — 2026-06-14

### Added — `/planr-pipeline:dashboard` (live, read-only `.planr/` dashboard)

A new standalone command that launches (or reuses) a persistent localhost server
serving a visual projection of the project graph.

- **Six views** — Overview · Graph · Board · List · Sprints · Activity — rendered
  from a typed `{ nodes, edges }` graph (`schemas/v1.0.0/graph.schema.json`) that
  covers both the agile model (epic/feature/story/task) and the spec model
  (spec/story/task).
- **One engine, one truth** — the graph data path mirrors the
  `/planr-pipeline:status` A.1/A.2 contract: delegate to the planr CLI
  (`planr graph --json` / `planr status --json`) when present and new enough,
  otherwise fall back to a native frontmatter reader. Both paths return an
  equivalent, schema-valid graph.
- **Live sync** — a debounced `.planr/` file watcher pushes minimal patches over
  an SSE stream so the dashboard updates in place (≤1s), preserving the active
  view, zoom, selection, and filters. `--no-watch` serves a static snapshot.
- **Read-only** — the server, engine, and watcher only read; there is no
  write-back to `.planr/`.
- **Conformance** — added `conformance/verify-dashboard.mjs` (palette fidelity
  against the design-system tokens, brand hygiene, and graph-schema presence) plus
  `node:test` suites for the graph schema, native↔delegate graph equivalence, the
  server routes, and the watcher debounce/scope. Wired into `npm test`.

## [0.20.0] — 2026-06-12

A field-driven release across four fronts: wide DEV dispatch, a chooseable dispatch style,
a real design↔implementation gate, and board export. Built from an exhaustive recon and
hardened through two adversarial review passes (15 findings found + fixed, then re-verified).

### Changed — `/ship` dispatches wide by default (the 1–2-agent problem, fixed)

The orchestrator was under-dispatching to 1–2 subagents not because of a cap but because of
**framing**: every loud cue said "one user story at a time, Frontend‖Backend, in order." The
DEV dispatch is reframed so **feature-flat, dispatch-every-eligible-task** is the canonical,
explicitly-instructed default:

- The queue is collected across **ALL stories** (user-story folders are not a dispatch
  boundary); the orchestrator dispatches **every** ready task (no unmet `dependsOn`) in one
  turn, rolling forward as dependencies clear instead of waiting for a whole batch. The
  Frontend‖Backend-within-one-US picture is now labelled the *smallest* case, never the
  ceiling. The host's native concurrency cap is the only throttle.
- The single-writer bookkeeping is reframed as a mechanical batched stamp/reconcile, not a
  per-dispatch throttle; "no isolation" is reframed as "decomposition makes ready tasks
  write-disjoint, so wide is *safe*." Propagated through `ship.md`, the dispatch procedure,
  `pipeline-overview.md`, `rules.md`, `compatibility-matrix.md`, `docs/protocol/commands.md`,
  `agent-model-map.md`, and `AGENTS.md`. The SPEC-014 ND1–ND4 state contract is unchanged.

### Added — dispatch style: free `native` vs deterministic `workflow`

On Claude Code multi-task, `/ship` now offers **how** the wide fan-out runs, via the cost gate
(clickable) or `--native` / `--workflow`:

- **`native`** (default) — the orchestrator emits the `Agent` calls itself; maximum flexibility.
- **`workflow`** — the orchestrator drives the **Workflow tool**, declaring the `dependsOn` DAG
  for the host to schedule deterministically and replayably. Same agents, same single-writer
  bookkeeping (the orchestrator pre-stamps every task and commits from each node's returned
  result — including the full error-report body on a block). No SPEC-014 worktree/wave machinery
  is revived; determinism comes from the host's Workflow tool.

The choice is suppressed on Cursor/Codex/unknown (no Workflow tool, no safe in-session fan-out →
per-task), recorded in the `.pipeline-shipped` marker (new optional `dispatch_style`; also fills
the previously-missing `runtime` field, and `unknown` is now a valid marker runtime) and a
`ship.dispatch-style-selected` manifest record. Cost gate reframed: wide = the **same total
tokens**, only less wall-clock (time estimate = longest dependency chain, not the sum).

### Added — design↔implementation fidelity gate (qa)

The design only ever paired to the build through `design-spec.md` tokens, and **nothing verified
the shipped UI against it** (qa didn't even read `design-spec.md` — an unmet R10). The qa-agent
now runs a Design Fidelity gate on every UI feature:

- **Artifact structure (R10)** — structurally validates `design-spec.md` itself (10 sections,
  §1 hex present, §9 ≥1 screen, §10 Open Questions cleared) and **FAILs** a UI feature whose
  designer output is missing/empty (no more fabricated "n/a" pass); "n/a" is reserved for
  genuinely backend-only features.
- **Build-fidelity lint** — lints the **compiled CSS** the build emits with
  `lib/design/lint.mjs --expect-styles` (new flag: zero parsed declarations exits 3 so "checked
  nothing" can't read as clean; bare `.css` is auto-wrapped; rem/em spacing is normalized to the
  px grid so Tailwind's rem-compiled off-grid is caught). Off-grid spacing and sub-AA contrast in
  the *shipped* styles are 0-error gates.
- **Off-palette colour check** — flags any colour literal (hex/rgb/hsl/oklch, shorthand-normalized)
  not in the §1 palette. It does **not** false-fail a screen for the palette roles it didn't use,
  and is indirection-safe (`var()`/theme keys/utility classes resolve to tokens).

### Added — PNG / HTML export on the design board

The review/loop board gains a top-bar **Export** menu — PNG of the current screen or the full
design (rasterised from the same-origin artifact iframe via the proven canvas pipeline), and an
HTML download. The copy is explicit that **PNG is a reference image** and the **HTML +
`design-spec.md` is the real design→build handoff** (a PNG is a screenshot for tickets/PRs/decks,
not the implementation substrate).

### Tested

127 unit tests + the SPEC-014 ND1–ND4 native-dispatch fixtures + both conformance suites, all
green. The dispatch rewrite, the workflow stamp lifecycle, the rebuilt fidelity gate, and the
linter hardening (`--expect-styles`, `.css` auto-wrap, rem/em) are each independently tested or
conformance-locked.

## [0.19.5] — 2026-06-11

### Changed — the /ship cost gate is a clickable AskUserQuestion, not a typed magic word

The COST ESTIMATE halt asked the user to literally type `proceed` — while the runtime has a
first-class question tool (the same one `/design` Phase B already enforces). The gate
(`ship-arguments-and-cost-gate.md` § B.3) is now a **mandatory `AskUserQuestion` tool call**
with the spend summary in the question text and clickable options: **Ship the batch**
(recommended) · **Narrow the batch** (re-estimates the subset, same as `--task T-NNN`) ·
**Skip extras** (`--no-devops`/`--no-docs`, re-gate) · **Cancel**. `--yes` still skips the
gate; runtimes without an AskUserQuestion variant (rule-generated Cursor/Codex) keep the typed
`proceed` fallback. Consent is never fabricated on either path.

## [0.19.4] — 2026-06-11

### Fixed — pins are content-anchored: exact through pan, zoom, and scroll

Field report from a canvas review: a pin dropped while panned deep into the canvas recorded
viewport ratios (`x: 0.31` of the browser window) with no screen id — meaningless to the agent
and visually drifting on every pan. Pins on iframe artifacts are now **content-anchored**:

- The click resolves the **artboard/screen element under it** — canvas `[data-dc-slot]`, then
  `[data-screen]`, then `section[id]` (the old mapper only knew walkthrough anatomy, so canvas
  pins never carried a screen id).
- Coordinates are stored **relative to that element's box** — invariant under the canvas
  transform, so the same ratio means the same spot at any pan/zoom/scroll state.
- `pin.screen` carries the anchor id, giving `/design-review` the exact artboard to regenerate.
- Markers **re-resolve the anchor's live rect** (~8×/sec) and ride along as the canvas moves,
  hiding when the anchor leaves the viewport instead of floating orphaned. The pin popover opens
  at the actual click point. Images/SVGs are unchanged (the media is the content there).

## [0.19.3] — 2026-06-11

### Changed — the board is a design tool now: rails + stage + inspector

Live review feedback: the stacked single-column board wasted the viewport and controls fought
the artwork. The board is now a three-pane shell —

- **Left rail — variants**: live thumbnails + generation state, one-click switching (also
  `←`/`→`); the versions list lives here, and picking two turns the stage into the A/B slider.
- **Stage — full-bleed**: the selected design large on a dot-grid backdrop; HTML artifacts
  (canvases, walkthroughs) fill the viewport and stay fully interactive in Interact mode.
- **Right rail — inspector**: rating + notes for the selection, a managed **pin list** (intent
  chips, screen ids, click-to-jump highlight, delete), next-round actions (overall direction,
  regenerate, remix), and the approve dock that morphs into the ✓ receipt.
- Both rails collapse (`[` / `]` or the header toggles) for a true full-screen stage; `P` still
  flips Interact/Pin. Compact 12.5px chrome; warm hairlines carry structure, teal is reserved
  for interactive elements. The feedback handshake is byte-identical.

### Fixed — canvas "view-only" banner showed inside the review board

The standalone-file warning fired in every context without a host bridge — including the review
board, where the design IS connected to its project and pins are the editing path. The banner now
additionally requires being the top-level window (a bare file open); embedded surfaces suppress
it while edit affordances stay correctly disabled. Copy reworded to route to
`/planr-pipeline:design-review <slug>`.

## [0.19.2] — 2026-06-10

### Changed — premium board UI; canvas artifacts stay fully interactive in review

Field feedback on `/design-review` with a canvas artifact: the review board's pin overlay sat
on top of the iframe and swallowed every pointer event — the canvas read as **frozen** (no
pan, no zoom, no drag). And the dark chrome + thin success banner felt sub-premium.

- **Interact / Pin modes** (header toggle, or press **P**): HTML artifacts — including
  canvases and walkthroughs — now load in **Interact** mode, where the pin layer passes
  pointer events through, so the canvas pans/zooms exactly as it does standalone. Switch to
  **Pin** to annotate (images/SVGs still default to Pin). The review-mode popover shows the
  captured screen id before you commit the pin.
- **Premium reskin** on a cream + teal palette (`#f7f3e7 · #e1f2e8 · #b4e7d9 · #7cd2c1 ·
  #4ab8a1 · #1f8f7d`): frosted sticky header + approve bar, white cards with soft teal
  elevation, mint section surfaces, refined stars/pins/popovers, single-column layout for
  review mode, and the versions panel only appears once versions actually exist.
- **Unmistakable submission:** the approve button reports progress, then the whole bar
  morphs into an animated ✓ receipt summarizing exactly what was written
  ("running with artifact · 2 ratings · 3 pins"), the banner confirms the file write, and
  the tab title gains a ✓. Regenerate/remix sends show the same summary.

Conformance locks the mode toggle + receipt into the served board. 122 tests + 2 suites green.

## [0.19.1] — 2026-06-10

### Fixed — board URLs without the trailing slash broke every relative asset

First field run of `/design-loop` surfaced it: terminal linkifiers routinely drop the
trailing slash from the printed `BOARD_URL`, and the daemon served the board page at
`/boards/<id>` anyway — so the browser resolved every relative URL against `/boards/` and
the whole board silently broke: **404 images, dead progress polling, and lost feedback
submits** (`/boards/api/feedback` → unknown board). The daemon now **301-redirects**
`/boards/<id>` → `/boards/<id>/` (the canonical form), and honors **HEAD** like GET on
static assets. Also from the same field run: when no key resolves but the project's
`.env` holds one, `doctor`/auth now print a **HINT** explaining the key is dormant by
design (the engine never auto-reads `.env` — silent-billing protection) and how to
activate it, instead of a bare `hasKey:false`. Conformance now locks the redirect, the
followed-redirect board, and HEAD behavior.

## [0.19.0] — 2026-06-10

### Added — the Design Loop Engine (`/design-loop` + `/design-review`)

An interactive, immersive design-iteration system — a proven design-shotgun flow
generalized for ANY design target, plus a planr-native pin-review loop over generated
artifacts. Zero npm dependencies (`lib/design-engine/`, plain Node ESM).

- **`/planr-pipeline:design-loop {target}`** — logos, brand sheets, screens, OG images:
  taste-aware concept list (anti-convergence enforced) → a **mandatory concept gate before
  any spend** → N parallel variant subagents (structured `VARIANT_X_DONE/FAILED/RATE_LIMITED`
  reports, tmp→cp, quality gate + one retry, sequential fallback) → a live localhost
  **board** → file-handshake feedback → session-chained iteration → approval. R1: stops at
  approval.
- **Provider abstraction with graceful degradation** — `openai` (Responses API +
  `image_generation`/gpt-image-2; iterate via `previous_response_id` so feedback *refines*;
  gpt-4o vision quality gate) and **`claude-svg`** (always available, $0: the agent authors
  exact SVG sheets against a validated contract — for logos/UI often better than diffusion).
  Auth: `~/.planr/credentials.json` → env (with the **silent-billing disclosure** when the
  key also sits in the cwd `.env`, + a not-gitignored warning) → guided `setup` with a real
  smoke test and printed proof. Keys are never echoed.
- **Board daemon v2** — persistent localhost server, board registry, `BOARD_URL:` stderr
  line, in-tab reload, per-board mutex; **pin-comments** (normalized region annotations
  with `fix|improve|question` intent), **versions rail with A/B slider diff**, **live
  per-variant progress** (file-driven `progress.json`), the proven approve bar. One
  self-contained HTML, no CDN, works offline.
- **`/planr-pipeline:design-review {slug}`** — serves an existing `finalized.html`/
  `canvas.html` through the board; every pin auto-maps to its screen/section; **only the
  pinned screen is regenerated** (HTML edits through the design system's tokens); the lint
  gate stays 0-error; on approve `finalized.json.iterations` bumps, the changed
  `design-spec.md` sections sync, and a `design.review` record lands in
  `.run-manifest.jsonl`.
- **Taste memory** — per-project profile updated on BOTH approve and reject; 5%/week
  confidence decay computed at read time; profile↔brief conflicts flagged, never silently
  resolved.
- **Schemas** (`design-feedback` incl. pins, `design-session`, `taste-profile`,
  `design-approved`) — every engine read/write validates.
- **Tests:** 121 unit (auth order + disclosure, session chaining, submit-vs-pending +
  consume-on-read, pin clamping, taste decay math, provider fallback, mocked OpenAI
  provider, sheet-contract validation) + a **full mocked-loop conformance** run
  (`conformance/verify-design-loop.mjs`, $0, no network). Docs: `docs/design-loop.md`
  (daemon protocol, feedback handshake, provider interface, 5-minute demo).

## [0.18.1] — 2026-06-10

### Added — `/planr-pipeline:status` with no slug = whole-project delivery report

`/status` was slug-only (pipeline marker + story/task counts for one feature). With **no slug** it
now produces the **whole-project delivery report** — every Spec / Backlog item / Quick Task rolled
up by status (done · promoted/superseded · outstanding) with GitHub PR + Linear cross-references and
an **Outstanding work** section. Architecture: **delegate-first** — when the planr CLI is installed
the command runs `planr status --md` verbatim (one deterministic engine, the two surfaces can't
drift; the engine lives in the CLI's `delivery-status-service`); without the CLI — or with a CLI
older than **1.7.2** (which lacks the delivery report) — it composes the same report shape natively
from `.planr/` frontmatter (read-only, never inventing a status, PR correlation via `gh` labeled
best-effort). The slug path is unchanged. Pairs with openplanr CLI **1.7.2**.

## [0.18.0] — 2026-06-08

### Added — a project design system + a "no-system → ask" gate (designs continue one feel)

planr could generate good per-feature designs but had no concept of a project-wide design
**system**, so a `/design` run with no DESIGN.md / theme fell back to a generic, **standalone**
look — which, as the user put it, "will be useless." v0.18.0 gives planr a first-class design
system and makes every design a *continuation* of it (the Atlas + Core-Asset-Protocol model,
adapted natively — no vendored dependency).

- **A design-system package** — `.planr/design-system/` (spec-driven) / `input/design-system/`
  (default), shared by every feature: `tokens.css` (portable custom properties, light+dark,
  4-point spacing, AA-verified pairs), `manifest.json` (machine tokens), `brand.md` (positioning,
  personality, voice, naming, contrast), `components.md` (per-surface recipes + premium polish).
  Resolved by `lib/design/designSystem.mjs`.
- **The no-system gate** — when none exists, `/design` preflight (**A.3.6**) fires a **mandatory
  AskUserQuestion**: **Generate one** · **Use an existing one** (a path) · **Describe the brand** ·
  **Cancel**. It never proceeds generic; whatever you pick is **persisted** and reused by every
  future `/design` + the PO designer-agent — continuity by construction. `--system` (re)generates
  the system only.
- **A design-system generator** (`procedures/design-system-generate.md`) — existing-app scan,
  brand answers, or an Advisor mode (3 directions when vague); writes the package on the 4-point
  grid with AA contrast.
- **Token + contrast adherence** — new `lib/design/contrast.mjs` (a WCAG helper parsing
  `#hex`/`rgb()`/`oklch()`, validated against a published Atlas 17.7:1 pair). The linter now
  **fails** on `contrast-below-aa` (the "faint text" defect) and **warns** on raw-color /
  non-design-system-font usage (the Atlas `_adherence` model).
- **Native anti-slop principles** (`agents/modes/shared/design-principles.md`) — no decorative
  gradients / emoji UI / fake imagery / lorem.

`npm test` → **90 green** + conformance. No new command (the gate is internal to `/design`) — the
`openplanr` skill stays **1.8.0**. Follow-up (deferred): preview-specimen HTML + a self-describing
design-system SKILL.md package.

## [0.17.0] — 2026-06-08

### Added — responsive, fluid designs across breakpoint frames (desktop / tablet / mobile)

Generated designs were rigid: a fixed 1440 max-width that shrank/centered in dead space instead of
filling the viewport, with no breakpoints. v0.17.0 makes generation genuinely responsive:

- **Fluid by default (generate step C.0.6).** Screens fill `100%` of their container with fluid
  grids (`repeat(auto-fit, minmax())`) and `fr`/`%` tracks — no `max-width: 1440` dead-space cap
  (only a readability cap on long-form prose). Density scales with the available width.
- **Container queries, not media queries.** Screens set `container-type: inline-size` on the root
  and author breakpoints with `@container` (desktop ≥1280, tablet ≥768, else mobile). This is the
  key insight: on a canvas every frame shares one browser viewport, so only a *container* query
  lets the SAME HTML reflow into a 1440 frame vs an 834 vs a 390. `BREAKPOINTS` + `RESPONSIVE_FRAMES`
  live in `lib/design/tokens.mjs`.
- **Canvas = breakpoint frames.** Each screen renders as three canonical frames — **desktop
  1440×1024, tablet 834×1194, mobile 390×844** — one section per screen, the same responsive HTML
  reflowing into each. A shared stylesheet is injected once (`DATA.css`); artboards are markup-only.
  A true Figma-style responsive board.
- **Prototype + walkthrough = live + a device toggle.** Both fill the viewport and reflow on resize,
  plus a **Fluid / Desktop / Tablet / Mobile** toggle (keys 1–4 in the prototype) that drives the
  container width — preview every breakpoint without resizing the window.

`lintCanvasData` accepts the three canonical frames and rejects anything else. `npm test` → 74 green
+ conformance. No routing change — the `openplanr` skill stays **1.8.0**.

## [0.16.2] — 2026-06-08

### Fixed — canvas focus modal opens at ACTUAL SIZE (the lightbox no longer rescales the screen)

The downloaded HTML and the canvas grid always rendered each screen at its real `1440×1024` — but
the **focus/lightbox modal** scaled the frame to *fit the window* (e.g. 80% on a 1080px-tall
display, since a 1024-tall frame + the modal's chrome doesn't fit). That made the *preview* measure
~`1153×820` and rescale on every window resize — so the modal, not the design, was "making the
width not real". Confirmed by a user: the exported screen HTML inspects as exactly `1440×1024`; only
the modal was off. Now:

- The focus modal **opens at actual size (1:1)** — the screen renders at its real `width×height` and
  **scrolls**, centered when it fits. Inspect it → real `1440×1024`. Resize the window → the frame
  stays put (only the scroll area changes); a resize can no longer "break" the dimensions.
- **Fit-to-window** becomes the opt-in (click the badge or press **0** / **f**); **1** returns to
  actual size. The `1440×1024 · 100%` badge always shows the real size.

No generation change — preview behavior only. Recompiled into the vendored `DesignCanvas.js`.

### Changed — brand hygiene (proprietary product)

A DevEx review found third-party project names woven through the canvas: the editing /
persistence bridge and a chrome attribute carried a foreign host-runtime's name, and a few
comments referenced other projects by codename. Renamed to neutral proprietary handles —
**`window.__canvasHost`** + `data-dc-chrome` — and dropped the codename references from
comments and the README. (The vendored **Pretext** text-reflow runtime keeps its name, like
React — it's an attributed third-party dependency, not our brand.) A new conformance check fails
the build if any of those names reappears in the shipped design assets.

`npm test` → 73 green + conformance. Skill stays **1.8.0**.

## [0.16.1] — 2026-06-08

### Fixed — canvas focus view labels real dimensions + adds an actual-size (1:1) toggle

The canvas focus/present view scales each screen to fit the window (like Figma zoom), so
inspecting it measured a *scaled wrapper* (e.g. `1029×732` = `1440×1024 × 0.71`) — which reads as
"the screen isn't real desktop size". It always was `1440×1024` (`transform: scale` is paint-only;
it never changes the element's box — the wrapper is sized *from* it, not the reverse), but nothing
on screen said so. Now:

- The focus view shows a **`1440×1024 · 71%` badge** — the screen's real dimensions plus the
  current zoom, so the scaling is explicit and the true size is unmistakable.
- Click the badge (or press **1**) for **actual size (1:1)** — the artboard renders at its real
  pixels and scrolls; press **0** / **f** to fit again. In 1:1 mode the inspected element measures
  the real `1440×1024`.

No generation change — purely the preview's clarity (recompiled into the vendored
`DesignCanvas.js`). `npm test` → 73 green + conformance. Skill stays **1.8.0**.

## [0.16.0] — 2026-06-08

### Added — design tokens + a deterministic linter (machine-enforced sizing/spacing)

Prompt-level self-review tightened craft but couldn't *guarantee* it — generated screens still
drifted on internal spacing (`14px` next to `12px` next to `16px`) and per-screen frame size
(760 / 700 / 820). v0.16.0 makes consistency an **engineering** property, not a vibe:

- **A fixed token vocabulary** (`lib/design/tokens.mjs`) — spacing is the **4-point grid**
  (`0`, `2`, or any multiple of 4; preferred steps 4/8/12/16/24/32/48/64), and every desktop
  screen uses **one canonical frame** `1440×1024` (`FRAMES.desktop`). The generator authors from
  this scale and reuses shared component classes, so off-scale values and same-type drift become
  *impossible* by construction (new generate step **C.0.5**).
- **A deterministic linter** (`lib/design/lint.mjs`) — parses the generated HTML/CSS and **fails**
  on `spacing-off-grid` (any padding/margin/gap/inset off the grid, in a `<style>` rule or inline)
  and, for canvas, `frame-not-canonical` (an artboard that isn't `1440×1024`); flags
  `inline-sizing-drift` as a warning. The finalize gate (**C.4.5a**) runs it and snaps every error
  to the nearest grid step, re-running until it exits 0 — verification by code, then the visual
  self-review (**C.4.5b**) for what static analysis can't see. Also a CLI:
  `node lib/design/lint.mjs <file.html>`.
- **Canonical frame** replaces v0.15.1's per-screen "full content height" — all desktop artboards
  are `1440×1024`, comparable like a real Figma file; taller content scrolls inside the screen.
- **The shells now dogfood the grid** — the linter found 12 off-grid values in our own
  prototype/walkthrough/canvas shells (6px/9px/11px/14px paddings); all fixed, and a conformance
  check keeps them clean (generated files inherit shell CSS, so the framework must obey its own
  scale).

`npm test` → 73 green + conformance (token scale, linter catches off-grid/off-frame, shells clean).
No routing change — the `openplanr` skill stays **1.8.0**.

## [0.15.1] — 2026-06-08

### Fixed — canvas designs look like real desktop screens (zoom, size, front-loaded context)

Three gaps remained after v0.15.0's "match the app" work, all surfaced by real `/design` runs
whose canvas artboards inspected as `width:1320px; height:860px` and rendered **zoomed-in**,
filling the window instead of reading as real screens:

- **The focus/present view scaled artboards UP to 2× to fill the window** — so a screen was never
  shown at real size; it was stretched to fill, which read as "zoomed in" and magnified every
  spacing imperfection. The overlay now **caps at 1:1**: a desktop screen renders at real pixels,
  shrinking only to fit the window, never enlarging.
- **Canvas artboards weren't desktop-sized.** The canvas generate step (C.4) gave the generator
  no sizing guidance, and the `DesignCanvas` fallback was phone-sized (`260×480`), so artboards
  were authored at an arbitrary width with a short fixed height that **cropped** a real scrolling
  page. C.4 now pins each artboard to **`width = VIEWPORT_W`** (the real desktop width, default
  **1440**) and **`height = the screen's full content height`** (no inner scroll; err tall), and
  the `DesignCanvas` fallback is now desktop **`1440×1024`**. (The cap + default changes are
  recompiled into the vendored `DesignCanvas.js`.)
- **App / design-system context was resolved late, in the generate step.** It was read inside C.0
  — *after* the format was chosen in Step B, bundled with escaping/manifest mechanics, and it
  never extracted a concrete desktop width. A new preflight step **A.3.5** front-loads
  **`APP_CTX`** (app shell · design tokens · component library · reference screens · **`VIEWPORT_W`**)
  **once, up front**; Step C now *consumes* it. `--dry-run` prints the resolved context.

A conformance check guards the desktop default + the front-loaded context against regression.
No routing change — the `openplanr` skill stays at **1.8.0**.

## [0.15.0] — 2026-06-07

### Added — design-craft rubric + mandatory self-review (professional polish)

Generated designs made amateur craft mistakes — inconsistent sizing (e.g. an `error` pill and
a `warn` pill different heights), off-scale spacing, sloppy alignment. The generate step had no
craft discipline and no forcing function to re-examine its own output. Two native additions
(learned from the MIT UI-UX-Pro-Max skill's execution rules + universal craft, encoded
in-plugin — **no external dependency**):

- **`agents/modes/shared/design-craft-rubric.md`** — single-sourced rules the generator applies
  *as it builds*: one spacing scale (no arbitrary `13px`/`17px`), **same-type elements the same
  size** (every pill/badge/button/card/input in a group identical), grid/baseline alignment, a
  consistent type scale, AA contrast (≥4.5:1), SVG icons (never emoji), `:focus-visible` +
  150–300ms hover, `prefers-reduced-motion`.
- **`design-step2-generate.md` § C.4.5 — mandatory self-review pass.** Before finalizing, the
  generator **audits its own artifact** against the rubric's checklist (especially sizing
  consistency, spacing, alignment) and **fixes every violation in place** — the forcing function
  that turns a first-draft layout into a professional one. (We pick the *execution* discipline
  from UI-UX-Pro-Max, not its style-selection engine, because `/design` matches the existing
  app's design system, not a fresh industry palette.)

### Fixed — generated designs now match the real app (shell, design system, desktop viewport)

Generated screens were rendering as a generic, narrow card on gray — not a real desktop view,
and ignoring the host app's shell and design system. The generate procedure only said "fill
the shell with realistic content"; it never told the generator to ground the design in the
target app. Added **`design-step2-generate.md` § C.0**:

- **Read + embed the app shell.** Find the app's layout/chrome (`app/layout.*`, `src/App.*`,
  `components/{Layout,Shell,Sidebar,Nav,Header,Topbar}.*`) and render each screen **inside it**
  (real sidebar/nav/header), not as a free-floating card (cards are only for genuine modals).
- **Match the real design system.** Read `DESIGN.md`, the CSS/Tailwind theme, the
  `ComponentLibrary`/`FrontendFramework` from `input/tech/stack.md`, and 1–2 existing
  screens; match the real colors, type scale, spacing, radii, and components.
- **Design at the real viewport.** Desktop web app → **full-bleed ~1440px** (not a narrow
  card in empty space); responsive → the app's breakpoints (375/768/1024/1440).

Also raised the walkthrough gallery's max width 1280px → **1680px** so a real ~1440px desktop
screen fits without being squished, and reinforced the same guidance in the prototype +
walkthrough shell generator contracts.

## [0.14.0] — 2026-06-07

### Fixed — `/design` no longer silently invents a spec; asks + adds standalone exploration

When `/design` ran in spec-driven mode with **no spec for the slug**, the procedure said
"abort, do not invent a spec" — but the model deviated and **silently scaffolded a tracked
`SPEC-NNN-<slug>`** into `.planr/specs/`, polluting the user's planning system with a spec
they never asked for (and inconsistently — other runs aborted on the same condition). Now the
no-spec case is a **mandatory `AskUserQuestion`** (same enforcement as Phase B):

- **A) Create a spec** — scaffold `SPEC-NNN-<slug>` as the home (explicit, user-chosen) → the planned-feature path `/plan` can consume.
- **B) Standalone exploration** — design only, into a new **`.planr/designs/<slug>/`** location; **no tracked spec is created**. (Mirrors the reference skill's spec-less design.)
- **C) Cancel.**

`--yes` assumes **standalone** (non-polluting); it never silently creates a spec. The Phase-D
handoff is standalone-aware (no false "UI tasks will now generate" when there's no spec).

### Fixed — generator resolves the plugin root instead of giving up

`$CLAUDE_PLUGIN_ROOT` is usually **unset** in the Bash subprocess, so `/design` was always
falling back to hand-authoring `finalized.json` and hand-escaping — meaning the **tested**
`lib/design` escaping + manifest validation (the real S1 XSS guard) never ran at generation
time. `design-step2-generate.md` now instructs the generator to **derive the plugin root from
a procedure file it is already reading** (`<root>/procedures/…` → `<root>/lib/design/…`) and
invoke the helpers via `node`, falling back to direct authoring only when the root is
genuinely unresolvable.

## [0.13.4] — 2026-06-07

### Fixed — `/design` Phase B now actually fires the clarification prompt

The Phase B clarification described the source/format question in prose ("if unset, ask"),
which the model could rationalize away — in practice it would **auto-decide format/source
from the brief and proceed** ("proceeding without further questions since your brief is
explicit"), never issuing a real prompt. Ported the reference implementation's enforcement into
`procedures/design-step1-clarify.md` (+ `commands/design.md`): Phase B is now a **mandatory
`AskUserQuestion` tool call** when the relevant flag is absent —

- it MUST be sent as a tool_use, never narrated as prose;
- an explicit brief is *content*, not the user's **format** (prototype/walkthrough/canvas)
  or **source** choice — a clear brief is not consent to skip the prompt;
- the recommendation is a **pre-selected default**, not a license to skip the call;
- a prompt is skipped only when both `--format` and `--from` are passed, or `--yes` assumes
  that question's stated default;
- if no `AskUserQuestion` variant is callable, **STOP** and report
  `BLOCKED — AskUserQuestion unavailable` — never silently default.

There is no system trigger that "invokes" the question — the model must choose to call the
tool, so the fix is forceful, explicit instruction that removes the skip rationalization.

## [0.13.3] — 2026-06-07

### Changed — `/design` keeps the project repo clean (scoped `.gitignore`)

Each `/design` run copied a self-contained runtime into the spec's `design/vendor/`
(~141KB React for canvas, ~30KB pretext for prototype/walkthrough) plus the generated HTML —
so designing across features committed the third-party runtime into git, per design. Now
`/design` writes a **`design/.gitignore`** that treats the rendered preview as build output:
**`design-spec.md` (the intent `/plan` consumes) + `finalized.json` are tracked**, while
`finalized.html` / `canvas.html` / `vendor/` / state / lock / temp are ignored. This scopes
only the directory `/design` generated — it never touches the developer's root `.gitignore`,
and deleting the file opts back into committing the full self-contained visual. The Phase-D
handoff states the policy.

### Changed — canvas uses a Figma-style dot grid

`templates/design/DesignCanvas.jsx` (and the compiled `vendor/DesignCanvas.js`) now render
the infinite canvas with a subtle **40px dot grid** on a clean near-white background
(`#fcfcfc`), replacing the old 120px square-line grid on warm gray. Recompiled with esbuild;
`node --check` clean, render verified.

## [0.13.2] — 2026-06-07

### Fixed — `/design` generation references the plugin root robustly (no hardcoded version path)

The Step C generate procedure referenced the `lib/design/*` helpers with bare paths, so when
the orchestrator shelled out to `node` to build `finalized.json` it hand-rolled an absolute,
**version-pinned** path (e.g. `…/planr-pipeline/0.13.0/lib/design/manifest.mjs`) — which is
wrong the moment the plugin updates. `procedures/design-step2-generate.md` now establishes a
**plugin-root handle** (`PLUG="${CLAUDE_PLUGIN_ROOT}"`, the currently-loaded install) and
invokes helpers as `node "$PLUG/lib/design/…"`, with a documented fallback (author the JSON
directly + validate against the shipped schema) when `$CLAUDE_PLUGIN_ROOT` isn't set. No
behavior change to generated artifacts.

### Fixed — stronger escaping instruction in generation

The escaping step is now explicit that **every** spec-derived string (screen titles, group
names, labels, copy, field names) must be escaped **before** it is written into the artifact,
**even when it "looks safe"** — closing the gap where a model might skip `escapeHtml` for an
"obviously harmless" title (SPEC-015 S1 hardening). The tested helper is unchanged; this
sharpens the runtime instruction.

## [0.13.1] — 2026-06-07

### Fixed — `/design` no longer dead-ends on a thin spec; it asks (DevEx)

When the structural screen resolver found **0 screens** (a spec organized as functional
requirements rather than a `## Screens` list / `ui_files:`, e.g. a `FR-A01…A19` spec),
`/design` v0.13.0 **aborted** preflight with a `Repair:` hint and forced the user to re-run
with `--from describe`. That dead-ended the whole point of the interactive flow ("the agent
triggers a question to collect what it needs"). The clarification (`AskUserQuestion`) lived
in Phase B but the abort fired in Phase A, before it could run.

Now an **interactive** run with 0 screens **asks** instead of aborting (Phase B § B.0.5):
derive the screens from the spec's requirements/flows · ground them in an existing design
doc the preflight auto-detects (`design/*.md`, e.g. `ux-flows.md`) · add a `## Screens`
section · cancel. Only a **headless** run (both `--format` and `--from` set, source not
`describe`) still aborts — it cannot prompt. The decision is a tested helper
(`lib/design/interactivity.mjs` `decideThinSpec` / `isHeadless`, + `tests/design/
interactivity.test.mjs`), not prose. The generator still never fabricates a screen list
silently (SPEC-015 F8/E3). Preflight now also detects `design/*.md` docs as a screen source.

### Fixed — task tracking no longer hard-codes the deprecated `TodoWrite` tool

Claude Code **deprecated `TodoWrite` in v2.1.142** (disabled by default in favor of the
`TaskCreate` / `TaskGet` / `TaskList` / `TaskUpdate` family). The `/plan` and `/design`
commands instructed the agent to "create a TodoWrite list," which silently no-ops on
modern Claude Code (the orchestrator fell back to inline tracking — work was unaffected,
but the progress UI was lost).

- `commands/plan.md` + `commands/design.md`: phase tracking now uses the current task
  tools (`TaskCreate` / `TaskUpdate`), with documented fallbacks — `TodoWrite` on Claude
  Code < 2.1.142, and inline tracking on Cursor/Codex or any runtime without a task tool.
- `procedures/plan-step0-preflight.md`, `plan-step1-mode-and-spec.md`,
  `plan-steps-2-through-completion.md`, `strategy-scaffold-node.md`: "TodoWrite item N"
  phrasing made tool-agnostic ("task-tracker item N"). On-disk phase verification is
  unchanged and still mandatory regardless of which (or no) task tool is present.

## [0.13.0] — 2026-06-07

### Added — `/planr-pipeline:design`: design generation before decomposition (SPEC-015)

A new **optional** command that turns a brief into a visual design **and** authors a
`design-spec.md`, so the PO Phase decomposes real UI tasks instead of silently degrading to
a Tech-only ship when no mockups exist. It runs **before** `/plan` (never inside it, never as
a post-`/plan` re-decomposition) and never auto-chains. Reviewed via `/autoplan`
(CEO → Design → Eng → DX) before implementation — see `docs/design-command-plan.md`.

- **Three formats, one shared core.** `prototype` (one interactive Pretext screen),
  `walkthrough` (multi-screen gallery; sidebar **anchor-scroll ≤8 screens**, **lazy
  screen-switching >8**), and `canvas` (Figma-like pan/zoom board, vendored React). The
  shared core is three tested helpers; the three renderers are thin shells in
  `templates/design/`.
- **Clarification with a recommended default.** Source → format is asked via
  `AskUserQuestion` with the format pre-selected from the screen count
  (`0–2 → prototype · 3+ linear → walkthrough · 3+ exploratory → canvas`), outcome-labeled.
  Supplying `--format … --from …` **skips the prompt entirely** (fully non-interactive for
  CI), plus `--yes` / `--dry-run` to match the `/plan` `/ship` flag family.
- **Loop closes via R2.** `docs/rules.md` **R2 amended**: a UI task is born when a
  `design-spec.md` **OR** a PNG exists (previously PNG-only), aligning the rule with
  `specification-agent`'s `has_design` trigger.
- **Honest canvas.** Opened without a host bridge, the canvas disables edit affordances and
  shows a view-only banner; **Export PNG/HTML stays the primary action**. React + the
  compiled `DesignCanvas` are vendored locally (SRI-pinned) so the artifact opens offline.
- **Tested core + security.** `lib/design/` (escape, recommendFormat, screens,
  walkthroughNav, manifest) with 27 unit tests; all spec-derived text is HTML-escaped /
  JSON-serialized (`escapeHtml` / `embedJson`) with an injection regression. New
  `schemas/v1.0.0/design-manifest.schema.json` (field `design_format`, not the reserved
  `format`). New `conformance/verify-design-assets.mjs` + `conformance/fixture-design/`,
  wired into `npm test`.
- **Single-sourced contract.** The 10-section `design-spec.md` template moved to
  `agents/modes/shared/design-spec-template.md`, included by both `designer-agent`
  (extraction) and the generator (authoring) so it cannot drift.

### Changed

- `/plan` prints a one-line **stdout nudge** (`procedures/design-detect-nudge.md`) when a
  feature is UI-facing but has no design — never an interactive prompt, so `--dry-run` / CI
  stay unaffected.
- `procedures/mode-detection.md` documents the new `design/` artifacts dir (both modes) and
  the one-writer precedence for `design-spec.md`.
- `commands/plan.md`, `docs/rules.md` (R1 design corollary), `docs/pipeline-overview.md`,
  `README.md` updated.

## [0.12.0] — 2026-06-01

### Changed — Native host-driven parallel dispatch for `/ship` (SPEC-014; supersedes SPEC-013)

SPEC-014 is a deliberate **reversal** of the SPEC-013 (v0.11.0) DAG-aware wave scheduler. planr-pipeline is a planning and orchestration layer, not a runtime sandbox; parallel write-safety between concurrent agents is the host runtime's concern. The DEV phase now dispatches tasks as **native parallel `Agent` calls** directly on the shared main working tree, exactly like native Claude Code parallel sub-agents.

In Claude Code's multi-task dispatch mode the orchestrator emits **one `Agent` tool-call per ready task in a single assistant turn** — a task is *ready* when every id in its `dependsOn:` list is already `done`. There is **no worktree isolation, no merge-back, and no concurrency knob**; the host's native concurrency cap is the only throttle. Codex/Cursor (`per-task`) and `single-task` (`--task T-NNN`) dispatch exactly one task per invocation, unchanged.

planr does **no** write-set inference and **no** cycle detection. The only ordering it honors is an explicit `dependsOn:` field. The lock-list survives **only as an advisory note** in the dispatch prompt — it never serializes anything.

### Removed (SPEC-013 machinery)

- **Git-worktree isolation** — no more `.planr-worktrees/<id>` directories, `planr-wt/<id>-<slug>` branches, dependency-dir symlinking, or `isolation: "worktree"` on `Agent` dispatches.
- **DAG wave serialization engine** — write-set normalization, cycle detection, lock-list-driven serialization, and greedy wave selection are gone.
- **File-scoped merge-back** + the undeclared-write guard + the forbidden-file check.
- **Startup worktree reconcile sweep** (`commands/ship.md` Step 1.10).
- **`--max-parallel N`** flag and the `$SHIP_MAX_PARALLEL` binding (and its cost-gate multiplier).
- `.gitignore` entries `planr-wt` / `.planr-worktrees`.
- The 9 SPEC-013 conformance fixtures (`conformance/fixtures/parallel-dispatch-*`, ~120 assertions) and their runner functions.

### Added

- Optional **`dependsOn`** field on the task schema (`schemas/v1.0.0/task.schema.json`) — an array of `^T-\d{3}$` task IDs. Backward-compatible: task files without it stay valid.
- 4 native-dispatch conformance fixtures (`conformance/fixtures/native-dispatch-{nd1-parallel,nd2-advisory-locklist,nd3-dependson,nd4-per-task}`) + ND1–ND4 assertions in `conformance/runner.mjs`, wired into `.github/workflows/ci-parallel-dispatch.yml`.

### Migration notes

- **`--max-parallel` is gone.** Invocations that pass `--max-parallel` no longer have an effect — remove the flag. The host's native concurrency cap is the only throttle.
- **Accepted tradeoff:** planr no longer guarantees write-isolation between parallel agents. Avoid collisions through good task decomposition, the advisory lock-list hint, and the host agent's judgment.
- **Leftover artifacts from a prior 0.11.0 run:** any `.planr-worktrees/` directories or `planr-wt/*` branches left behind are no longer managed by planr and can be cleaned up with standard git — e.g. `git worktree remove .planr-worktrees/<id>` (or `git worktree prune`) and `git branch -D planr-wt/<id>-<slug>`.

### Files touched (v0.12.0)

- `commands/ship.md`, `procedures/ship-step2-dag-dispatch.md`, `procedures/ship-arguments-and-cost-gate.md` — native dispatch; worktree/wave/`--max-parallel` removed.
- `schemas/v1.0.0/task.schema.json` — optional `dependsOn`.
- `agents/**` shared QA/correction contract — `isolation`/worktree language removed.
- `conformance/runner.mjs` + `conformance/fixtures/native-dispatch-*` *(4 new fixtures; 9 SPEC-013 fixtures deleted)*.
- `.github/workflows/ci-parallel-dispatch.yml` — runs the native-dispatch suite.
- `docs/rules.md` (R11 removed), `docs/pipeline-overview.md`, `docs/protocol/runtime-adapters.md`, `docs/compatibility-matrix.md`, `docs/feat-parallel-dispatch/` *(rewritten to native dispatch)*.
- `.claude-plugin/plugin.json` — version `0.11.0` → `0.12.0`.

## [0.11.0] — 2026-05-30

### Added — DAG-aware parallel wave dispatch for `/ship` (SPEC-013, M1)

`/planr-pipeline:ship` can now dispatch multiple Tech/UI tasks **per orchestrator turn** instead of walking the queue one task at a time. In `DISPATCH_MODE: multi-task` (the default for the Claude Code runtime) the orchestrator computes a **wave** — a batch of tasks whose declared write-sets are disjoint — and emits one `Agent` tool-call per wave member in a single turn. Sequential dispatch is preserved exactly at `--max-parallel 1` and for the `per-task`/`single-task` runtimes (Cursor/Codex are **unchanged**).

**Why:** the DEV phase was strictly serial even when a feature's tasks touched non-overlapping files. Wave dispatch drains a queue of `N` write-disjoint tasks in `ceil(N/cap)` turns instead of `N`, with no change to the QA gate or the per-task R6 correction loop.

**Three-layer write-safety model (no clobbered files):**

1. **Lock-list serialization** — an inlined Node/TS lock list (`package.json`, lockfiles, `**/index.ts`, `prisma/schema.prisma`, `**/migrations/**`) forces any two lock-touching tasks to serialize even if their declared write-sets look disjoint. Empty/absent declared write-set ⇒ serialized alone.
2. **Worktree isolation** — each wave member runs with `isolation: "worktree"` on a private branch `planr-wt/<T.id>-<short-slug>` (dir `.planr-worktrees/<T.id>`, `node_modules` symlinked from main).
3. **File-scoped merge** — the orchestrator validates the worktree diff against the task's declared Create/Modify list and applies **only** those paths via `git checkout <wt-branch> -- <files>` (never a full `git merge`). Task `.md` status fields and `.run-manifest.jsonl` stay single-writer in main; any undeclared write fails the task into R6.

**Also added:**

- `--max-parallel N` (default `4`; `1` = sequential escape hatch; `≤0`/non-numeric = two-line fatal; `>20` = soft warning). Bound as `$SHIP_MAX_PARALLEL`.
- **Crash recovery** — `commands/ship.md` Step 1.10 reconcile (`git worktree prune` + sweep of dangling `planr-wt/*` branches) plus §2a `in-progress` re-queue bring a crashed run back to a clean, re-runnable state.
- **Determinism** — id-sorted waves; byte-for-byte legacy parity at width 1; cycle precheck fails fast (dispatch nothing) on a mutually-overlapping task set.
- **Shared contract rule 4** (`agents/modes/shared/contract-create-modify-preserve.md`) — the undeclared-write rejection policy, now defined once and cross-referenced (not duplicated) by the three QA agent files.
- **Conformance** — 9 new `--verify-ship` fixtures + assertions in `conformance/runner.mjs`: G1 multi-wave, G2 floor-of-1, G3 arg-validation, G4 sequential-parity, G6 crash-recovery, G7 file-scoped-merge, plus clobber-prevention, undeclared-write, and cyclic-dep fixtures (120 assertions total). Wired into a new CI workflow (`.github/workflows/ci-parallel-dispatch.yml`).

**Proof scope (honest M1 boundary):** the conformance suite proves clobber-prevention end-state and serialization of conflicting tasks via non-overlapping manifest intervals. It does **not** prove wall-clock concurrency (the orchestrator writes the timestamps). Explicit `dependsOn:` task dependencies, an authoritative `execution-plan.json` co-wave proof, and stack-extensible lock lists are deferred to **M2/M3**.

**Files touched (v0.11.0):**

- `procedures/ship-step2-dag-dispatch.md` *(new)* — the wave scheduler (Sections 1–9: input contract, cycle detection, inlined lock list, greedy wave selection, dispatch contract, worktree setup/dep-sharing, file-scoped merge, ship.md integration, determinism).
- `commands/ship.md` — Step 1.10 (worktree reconcile) + Step 2b-multi (wave-dispatch wiring; consumes `$SHIP_MAX_PARALLEL`).
- `procedures/ship-arguments-and-cost-gate.md` — `--max-parallel` parsing/validation → `$SHIP_MAX_PARALLEL`.
- `agents/modes/shared/contract-create-modify-preserve.md` — rule 4 (undeclared-write); `agents/qa-agent.md`, `agents/modes/default/qa.md`, `agents/modes/spec-driven/qa.md` — cross-reference it (DRY).
- `conformance/runner.mjs` + `conformance/fixtures/parallel-dispatch-*` *(9 new fixtures)*.
- `docs/rules.md` (R11 Wave Write-Safety), `docs/pipeline-overview.md` (Parallel Dispatch M1), `docs/protocol/runtime-adapters.md` (Worktree Isolation), `docs/compatibility-matrix.md` (SPEC-013 row); `docs/feat-parallel-dispatch/` *(generated feature docs)*.
- `.github/workflows/ci-parallel-dispatch.yml`, `.env.example` *(new)*.
- `.claude-plugin/plugin.json` — version `0.10.0` → `0.11.0`.

**Migration:** none. The task/spec **schema is unchanged** (M1 derives every serialize edge from file-scope inference + the lock list — no new frontmatter). Existing specs authored by the `planr` CLI dispatch under the new scheduler automatically; pass `--max-parallel 1` to opt back into strictly-sequential dispatch.

**Pairs with (ecosystem alignment):** only `openplanr/marketplace` needs a matching change — bump the `planr-pipeline` `version` pin `0.10.0` → `0.11.0` (after this repo is tagged `v0.11.0`). The **`openplanr` CLI and `openplanr-skills` need no update**: the schema is unchanged, the CLI vendors no pipeline files, and the feature is Claude-Code-only (Cursor/Codex remain per-task sequential, so their generated adapter rules stay accurate).

## [0.10.0] — 2026-05-30

### Changed — Frontier model bump: Opus 4.7 → Opus 4.8 (1M context) for DEV codegen

The DEV-tier codegen agents (`frontend-agent`, `backend-agent`) now ship with `model: claude-opus-4-8[1m]` in their YAML frontmatter. The `[1m]` suffix is Anthropic's selector for the 1M-context deployment of Claude Opus 4.8 (the same syntax as `/model claude-opus-4-8[1m]`). This makes Opus 4.8 with the 1M context window the default frontier for multi-file Tech and UI codegen tasks.

**Why:** Opus 4.8 improves multi-file coordination, framework-convention adherence, and design-token application — exactly the codegen surface the DEV phase exercises. The 1M context lets `backend-agent` keep an entire feature's task chain (US + 2-3 task files + design-spec + schema.json + active stack file + correction-loop history) resident across all three R6 iterations without spilling context.

**What stays the same:**

- **Sonnet 4.6 still owns the analysis tier.** `db-agent`, `designer-agent`, `specification-agent`, `qa-agent`, `devops-agent`, `doc-gen-agent`, and the new `entity-scaffold-agent` (Step 0.2, SPEC-005) continue to use `claude-sonnet-4-6`. The cost split (Opus where reasoning over many files matters; Sonnet where structured output suffices) is unchanged.
- **R3 model-assignment rule is unchanged in spirit** — the Opus tier identifier updated; the assignment table in `docs/rules.md` and `docs/agent-model-map.md` reflects the new string.
- **Tool restrictions, frontmatter `name` / `description` fields, and agent prompts are unchanged.** Manifest-enforced tool boundaries are not affected by the model bump.
- **Cost preview heuristics in `procedures/ship-arguments-and-cost-gate.md`** still reference per-million-token pricing for both classes. If Anthropic's price card for Opus 4.8 differs from 4.7, update that single line at COST ESTIMATE block § B.2.

**Files touched (v0.10.0):**

- `agents/backend-agent.md`, `agents/frontend-agent.md` — `model:` frontmatter updated to `claude-opus-4-8[1m]`.
- `agents/entity-scaffold-agent.md` — internal cross-reference to backend-agent's model updated.
- `.claude/commands/audit.md` — AGENT AUDITOR template's `MODEL:` reference updated.
- `docs/rules.md` R3 — model-tier assignment row updated.
- `docs/agent-model-map.md` — full model-tier table + rationale section updated.
- `docs/pipeline-overview.md`, `docs/protocol/agent-roles.md`, `docs/task-anatomy.md`, `commands/ship.md` — display references updated.
- `procedures/ship-arguments-and-cost-gate.md` — cost-preview model labels updated.
- `README.md` — feature summary, agent table, "Pinned model strings" footnote, and refresh date.
- `AGENTS.md` (Codex adapter), `.cursor/rules/planr-pipeline.mdc`, `.cursor/rules/agents/{backend,specification}-agent.md` — adapter mirrors updated.
- `templates/CLAUDE.md.tpl` — generated-project agent status table updated to `claude-opus-4-8[1m]` for the two DEV agents (so installs render the current model).
- `.claude-plugin/plugin.json` — version bumped from `0.9.1` to `0.10.0`.

**Migration:** none. Existing `/planr-pipeline:plan` and `/planr-pipeline:ship` invocations pick up the new model automatically on first dispatch after install. If you've forked any agent files and pinned `claude-opus-4-7` manually, swap to `claude-opus-4-8[1m]`.

**Pairs with (ecosystem alignment):** parallel updates required in the `openplanr` CLI (its agile-mode model-tier rendering), `openplanr-skills` (skill body templates that reference the Opus tier), and `openplanr/marketplace` (the marketplace.json pin for this plugin). Those repos are out-of-tree for this changelog entry but the model identifier needs to match for consistent docs across the ecosystem.

## [0.9.1] — 2026-05-11

### Fixed — Procedure files exposed as slash commands

`commands/procedures/` moved to `procedures/` at the plugin root. The Claude Code plugin loader registers every `.md` under `commands/` as a slash command — so 19 internal procedure files (mode-detection, memory-read, strategy-*, etc.) were polluting the user's autocomplete menu alongside the 3 real commands (`plan`, `ship`, `status`).

Users now see exactly 3 commands. Internal procedures are still readable by the orchestrator via `${CLAUDE_PLUGIN_ROOT}/procedures/` — no behavioral change.

#### Files touched

- 19 procedure files moved from `commands/procedures/` → `procedures/`
- All path references updated in `commands/plan.md`, `commands/ship.md`, `commands/status.md`, `docs/protocol/runtime-adapters.md`, and 7 procedure files that cross-reference each other

## [0.9.0] — 2026-05-11

### Added — Project memory, task rationale, clarification loop, R10

See [v0.9.0 release notes](https://github.com/openplanr/planr-pipeline/releases/tag/v0.9.0).

## [0.8.0] — 2026-05-03

### Changed — Mode isolation refactor

Dual-mode prompt content has been extracted from each agent prompt body into per-mode files under `agents/modes/`. Each entry file at `agents/<role>-agent.md` is now a thin loader (≤60 lines) that preserves frontmatter (`name`, `description`, `tools`, `model`) verbatim and adds a `Read` directive listing the mode-specific files the agent should load before executing.

**What stays the same:**

- **Both modes remain first-class user surfaces.** Default mode is the lightweight solo-dev fast-feedback path; spec-driven mode is the formal team / PO-handoff path. Neither is a fallback for the other.
- The security boundary at the `tools:` frontmatter is unchanged — manifest-enforced tool restrictions on Claude Code, advisory tool restrictions on Cursor and Codex, all carried verbatim from the previous entry-file frontmatter.
- The protocol artifact contract is unchanged — SPEC, US, and Task frontmatter still conforms to v1.0.0 schema; the `.pipeline-shipped` marker is unchanged.
- Existing user invocations of `/planr-pipeline:plan` and `/planr-pipeline:ship` continue to work in either mode with no observable behaviour change.

**Token cost:** approximately 30% per-invocation reduction. Only the active mode's content loads — the entry file (small), the matched per-mode file, and any shared topics it references. The inactive mode's prompt body is not read into the agent's context.

**New layout reference:** see the "Mode isolation (introduced in v0.8.0)" section in `docs/protocol/runtime-adapters.md` for the canonical file structure and adapter mirroring guidance.

**Pairs with:** SPEC-001 (Schema Discipline v1.0.0) — shipped concurrently in v0.8.0.

#### Files touched (mode isolation)

- 7 agent entry files rewritten as thin loaders (`agents/{specification,designer,frontend,backend,qa,devops,doc-gen}-agent.md`). `agents/db-agent.md` is unchanged — it has no dual-mode content.
- 14 new per-mode files at `agents/modes/{spec-driven,default}/<role>.md`.
- 3 new shared files at `agents/modes/shared/{contract-create-modify-preserve.md, correction-loop-frontend.md, correction-loop-backend.md}`.
- New `procedures/mode-detection.md` shared between `/plan` and `/ship`.
- Updated `commands/plan.md` and `commands/ship.md` to load the shared `mode-detection` procedure.
- New `conformance/fixtures/default-mode/` fixture plus updated `conformance/runner.mjs` that auto-detects mode from fixture layout.
- Harmonized `templates/spec.md.tpl` frontmatter to v1.0.0 schema.

### Changed — Agent prompt slim-down (SPEC-004)

**`docs/rules.md` § R6** is the only normative home for the DEV correction loop (command order, three passes, dual-mode error-report paths, pointer to future `T-<id>-error-report.md`). Agent prompts and `docs/pipeline-overview.md` link to R6 instead of duplicating multi-step loop prose. `agents/specification-agent.md` defers decomposition policy to **R2/R4/G1** and artifact shape to **`schemas/v1.0.0/{story,task}.schema.json`**. `templates/error-report.md` delegates pass semantics to R6. **`agents/modes/shared/correction-loop-*.md`** and per-mode **frontend/backend** tails were rewritten to reference R6 without `Iteration 1/2/3` blocks.

#### Files touched (SPEC-004)

- `docs/rules.md`, `docs/pipeline-overview.md`, `templates/error-report.md`
- `agents/specification-agent.md`, `agents/frontend-agent.md`, `agents/backend-agent.md`
- `agents/modes/shared/correction-loop-frontend.md`, `correction-loop-backend.md`
- `agents/modes/{spec-driven,default}/{frontend,backend}.md`

### Changed — Backend agent split (SPEC-005)

**`entity-scaffold-agent`** (Sonnet 4.6) owns optional **Step 0.2** manual ORM scaffold from `output/db/schema.json` → `output/src/`. **`backend-agent`** (Opus 4.7) is **DEV-only** (Step 3 Tech tasks). **`docs/rules.md`** R3 and protocol docs list both; **`commands/plan.md`** documents Step 0.2 dispatch without changing the default `/plan` Step 2 chain.

#### Files touched (SPEC-005)

- **`agents/entity-scaffold-agent.md`** — Sonnet 4.6, Step 0.2 manual scaffold only (`output/src/`).
- **`agents/backend-agent.md`** + **`agents/modes/{spec-driven,default}/backend.md`** — DEV-only (Step 3 Tech tasks); cross-link to entity-scaffold for 0.2.
- **`commands/plan.md`** — optional Step 0.2 → **entity-scaffold-agent**.
- **`docs/rules.md`** R3, **`docs/agent-model-map.md`**, **`docs/pipeline-overview.md`**, **`docs/protocol/agent-roles.md`**, **`README.md`**, **`agents/db-agent.md`** footer chain, **`.cursor/rules/planr-pipeline.mdc`**, **`.cursor/rules/agents/backend-agent.md`**, new **`.cursor/rules/agents/entity-scaffold-agent.md`**, **`.claude-plugin/plugin.json`**.

### Changed — Split `commands/plan.md` into procedures (SPEC-003)

`commands/plan.md` is a thin orchestrator (≤100 lines plus the immutable five-strategy matrix table bound to orchestration). PO Phase sequencing lives in `${CLAUDE_PLUGIN_ROOT}/procedures/plan-step0-preflight.md`, `plan-step1-mode-and-spec.md`, and `plan-steps-2-through-completion.md`, alongside the existing `strategy-*.md`, `stage-design-assets.md`, and `restore-design-assets.md` procedures. Behaviour is intentionally unchanged versus the inlined v0.7.3 prose; conformance remains the state verifier for PLAN+SHIP workflows.

Project root `input/tech/stack.md` now declares `schemaVersion: "1.0.0"` so schema validation exits clean.

#### Files touched (plan split / SPEC-003)

- Thin `commands/plan.md` plus new `procedures/plan-step0-preflight.md`, `plan-step1-mode-and-spec.md`, `plan-steps-2-through-completion.md`.
- Existing `strategy-*.md`, `stage-design-assets.md`, `restore-design-assets.md` procedure files finalized as authoritative strategy bodies extricated from `/plan`.

### Added — Run manifest + per-task error reports (SPEC-008)

`/planr-pipeline:ship` now appends a JSONL audit trail to `<SPEC_DIR>/.run-manifest.jsonl` (spec-driven) or `output/feats/feat-{slug}/.run-manifest.jsonl` (default). One record per orchestration boundary — `ship.bootstrap`, `ship.phase1`, `ship.task:T-NNN`, `qa-gate`, `devops-bundle`, `doc-gen-bundle`, `snapshot`, `marker-write` — with `started_at`, `ended_at`, `files_written`, `files_modified`, `exit_status`, `error_summary`, optional `cost_hint`. Manifest validates against `schemas/v1.0.0/run-manifest.schema.json` (additionalProperties: false, ISO-8601 timestamps).

Per-task R6 failures now write to `<SPEC_DIR>/tasks/T-NNN-error-report.md` (matching the YAML `id` field) — never the legacy singleton `tasks/error-report.md`. `qa-agent` reads per-task reports by ID; `templates/error-report.md` documents the convention as canonical.

`/planr-pipeline:status` reads the manifest when present and surfaces per-stage timing + cost cues. The manifest is git-ignored by default (`*.run-manifest.jsonl` in `.gitignore`).

#### Files touched (SPEC-008)

- `commands/ship.md` — Step 1.6 binds manifest path; emission contract documented.
- `schemas/v1.0.0/run-manifest.schema.json` — JSON Schema draft 2020-12.
- `agents/{frontend,backend,qa}-agent.md` + `templates/error-report.md` — per-task error filename convention.
- `commands/plan.md` (status command) — manifest read + timing surface.
- `.gitignore` — `*.run-manifest.jsonl`.

### Added — Task status state machine + cross-runtime resume

T-task frontmatter now carries a `status` field with enum `pending | in-progress | done | blocked` (validated by `schemas/v1.0.0/task.schema.json`). `/ship` Step 2 reads each task's status on entry, partitions the queue, and writes status updates inline as the pipeline progresses:

- `done` → skip (already shipped)
- `pending` → enqueue (fresh)
- `in-progress` → enqueue + recover (prior run crashed mid-task)
- `blocked` → enqueue + retry (prior R6 wrote `T-NNN-error-report.md`; new attempt re-reads it)

Before dispatch: status flips to `in-progress` + `updated:` bumped. On success: `done`. On R6 failure: `blocked` with companion error report.

This is the foundation for **resume semantics across invocations, sessions, machines, and runtimes**: re-running `/ship` on the same spec naturally picks up where the prior run left off — the source of truth is the task file frontmatter, not the orchestrator's memory.

### Added — Runtime adapter detection + per-task dispatch mode (`DISPATCH_MODE`)

`/ship` Step 1.7 binds `RUNTIME` from the environment:

- `claude-code` — `${CLAUDE_PLUGIN_ROOT}` resolves
- `cursor` — `.cursor/rules/planr-pipeline.mdc` exists at project root
- `codex` — `AGENTS.md` at root contains `## Planr Pipeline Orchestration`
- `unknown` — none of the above

`/ship` Step 1.8 selects `DISPATCH_MODE` accordingly:

| Runtime | Default `DISPATCH_MODE` |
|---|---|
| `claude-code` | `multi-task` (manifest-isolated subagents per task — no cumulative-context bias) |
| `cursor` / `codex` | `per-task` (one task per invocation; the Composer/persona session can't safely isolate per-task context across many tasks) |

In `per-task` mode, `/ship` dispatches one task (oldest `pending`, otherwise oldest `blocked`), closes its status to `done` or `blocked`, and prints:

```
⏸ Task T-NNN dispatched (success | blocked).
  Remaining: N task(s) {pending: A, blocked: B}.
  Run /planr-pipeline:ship {slug} again to continue.
```

The user re-invokes per task. The status field on each T-task naturally encodes "where to continue" without any state outside the spec directory.

**Override:** `--all-tasks` forces `multi-task` regardless of runtime (advanced — only when the runtime supports isolated subagents).

**Why this fix exists:** v0.7.x users on Cursor reported `/ship` producing a status rollup instead of generating code on partially-shipped specs. Root cause: Cursor's Composer is one continuous session — without per-task fresh invocation, prior tasks' context biased the model toward "this looks already shipped." The runtime-aware default is the architectural cure.

#### Files touched (status + dispatch)

- `commands/ship.md` — new Steps 1.7 (`RUNTIME`), 1.8 (`DISPATCH_MODE`), restructured Step 2 (status-aware queue + dispatch loop + status state machine).
- `agents/{frontend,backend}-agent.md` — task isolation contract pushes back on cumulative-context bias ("you see ONE task spec, do not write status rollups, generate code not commentary").
- `docs/compatibility-matrix.md` — new capability rows + dispatch-mode caveat section.

### Migration

None. No user action required. Existing projects continue to work in whichever mode they were using.

T-task files written by older specification-agent runs that lack the `status` field will be treated as `pending` on first read in v0.8.0. The pipeline will not retroactively rewrite them — author your migration via `planr task status set <T-NNN> <state>` if you want explicit state, or just let `/ship` write the field on next dispatch.

### Pairs with

- `openplanr` (planr CLI) v1.5.2 — unchanged
- `openplanr-skills` v1.4.0 — unchanged
- `marketplace` pin — bumped to v0.8.0 in a follow-on PR

## [0.7.3] — 2026-05-02

### Fixed — Pipeline cannot silently abandon mid-execution

A real greenfield smoke test on v0.7.2 exposed three classes of bug:

1. **Mid-task abandonment.** After the scaffolder ran (and surfaced an asset-folder conflict), the pipeline silently exited without continuing to bootstrap, spec authoring, or subagent dispatch. The user was left with a Next.js project but no `.planr/`, no spec, no PO Phase agents fired.
2. **Pre-existing design assets blocking the scaffolder.** A user-staged `Designs/` folder in the project root caused `create-next-app .` to refuse the directory.
3. **Silent path-expansion fallback.** `~/Designs/foo.png` from BRIEF, when not found at `$HOME`, fell back to project-local `Designs/` — which is what created the scaffolder block in the first place.

### Changed — Orchestration Contract + per-phase verification gates

The command now opens with a mandatory **Orchestration Contract** that names exactly four phases (A: Pre-flight, B: Mode + spec body, C: Subagent dispatch, D: R1 stop) and enforces:

- **TodoWrite is mandatory** at the start of execution. Phase progress is tracked as 4 todo items; each is checked complete only after on-disk verification.
- **You are NOT done when a Bash command succeeds.** Bash success is a step result, not a phase result. The model is explicitly instructed to return to the strategy and continue with the next sub-step.
- **Per-phase verification gates** between Step 0 → Step 1, Step 1 → Step 2, Step 2 → Step 3. Each gate enumerates required on-disk outputs.
- **A Completion Contract** at Step 3 with bootstrap / spec / decomposition / subagent-dispatch / stash-cleanup checkboxes. The model cannot print success unless every checkbox passes.

### Added — Designed asset stash (`STAGE_DESIGN_ASSETS` / `RESTORE_DESIGN_ASSETS`)

`SCAFFOLD_NODE` now has an explicit pair of common procedures (Steps 0.9 and 0.10) that:

- Detect known design-asset patterns at the project root (`Designs/`, `design/`, `mockups/`, `assets/`, `wireframes/`, top-level `*.png|jpg|jpeg|svg|gif|webp`)
- Move them to `/tmp/planr-pipeline-stash/<slug>-<unix-ts>/` before the scaffolder runs
- Copy them into `<SPEC_DIR>/design/` after Step 1 creates the spec design folder
- Delete the stash dir after restore-and-verify

If the project root contains files outside the recognized patterns, the strategy aborts with a clear message asking the user to clean the directory. The pipeline does NOT improvise around unknown files — and the `/tmp` stash is no longer an emergent recovery, it's a designed step the user can audit.

On scaffolder failure between stage and restore, the recovery flow moves the stash back to its original location for clean rollback (no half-state).

### Changed — Path expansion is fail-fast, not silent-fallback

When a path from BRIEF (e.g., `~/Designs/inbox.png`) doesn't resolve to an existing file after `$HOME` expansion, the command now logs a clear warning and continues — it does NOT silently fall back to a project-local path. Silent fallback is what created the scaffolder-block bug; loud warning is product-grade.

### Added — `$ARGUMENTS` sanitization (Step 0.0)

Defensive check before any other processing:

- `$ARGUMENTS` exceeding 5,000 chars → abort (prior conversation likely got pasted in)
- `$ARGUMENTS` containing literal `/planr-pipeline:` → abort (nested invocation paste)
- `$ARGUMENTS` empty → abort with usage hint

These cost nothing on normal invocations and prevent the "wall of nested narrative" rendering observed when a user pasted prior conversation content into the slash command.

### Migration

None. v0.7.0 / v0.7.1 / v0.7.2 invocations behave identically — the new contract + gates are additive checks the model runs internally. Existing planr projects (with `.planr/` already present) hit the `CONTINUE` strategy and skip Step 0 entirely.

### Pairs with

- `openplanr` (planr CLI) v1.5.2 — unchanged
- `openplanr-skills` v1.4.0 — unchanged
- `marketplace` pin — bumped to v0.7.3 in a follow-on PR

## [0.7.2] — 2026-05-01

### Changed — Step 0 redesigned as a state machine

`commands/plan.md` Step 0 is rewritten from an imperative six-substep sequence (v0.7.1) into a state machine. Detect once, pick exactly one strategy from a five-row decision matrix, execute that strategy as a clean linear sequence.

**Why:** v0.7.1's imperative ordering bootstrapped `.planr/` and `input/tech/` *before* asking the user "scaffold first?". On consent, `npx create-next-app .` then refused to run because the directory was no longer empty. The orchestrator was observed to recover by improvising a `mv to /tmp` stash on a real greenfield run — clever, but bad UX (scary, fragile). The plugin should never put the model in a position where it has to improvise around a contradiction.

**The five strategies:**

| `HAS_PLANR` | `HAS_PACKAGE_JSON` | `BRIEF_STACK` | Strategy |
|---|---|---|---|
| ✅ | any | any | `CONTINUE` — skip Step 0, go to Step 1 |
| ❌ | ✅ | any | `BOOTSTRAP_ONLY` — write `.planr/` on top of existing project |
| ❌ | ❌ | `node` | `SCAFFOLD_NODE` — identify framework from BRIEF, run its canonical scaffolder, then bootstrap `.planr/` on top |
| ❌ | ❌ | `non-node` | `ASK_MANUAL` — clear instructions to scaffold + re-run |
| ❌ | ❌ | `none` | `ASK_STACK` — clear instructions to declare a stack |

`SCAFFOLD_NODE` is **framework-agnostic within the Node ecosystem.** It supports Next.js, NestJS, Vite (React/Vue/Svelte/Solid/Lit), Nuxt, Astro, Remix, SvelteKit, Hono, SolidStart, Fastify, Express, and any other Node framework the model identifies from BRIEF. The scaffolder command isn't hardcoded — the strategy documents the supported set + common defaults (TypeScript, no-git, npm), and the model picks the right canonical CLI for the framework BRIEF declares.

### Removed

- The "scaffold first?" consent prompt. When `BRIEF` declares a Node stack and the directory is empty, the intent is unambiguous; the system acts on it. Press Esc to abort during the announce phase.
- The `/tmp` stash improvisation path. Structurally impossible now — `create-next-app .` runs first in an empty dir, before any planr files are written.

### Added

- Common procedures `WRITE_PLANR_DIRS` and `AUTHOR_STACK_FROM_BRIEF` factored out as their own subsections, reused by `BOOTSTRAP_ONLY` and `SCAFFOLD_NODE`. Clean code, no duplication.
- Explicit `BRIEF_STACK` keyword classification table (Node / non-Node / none). Documented and easy to extend in a future patch.

### Migration

None. v0.7.1 invocations continue to work — the state machine subsumes the same behaviors with cleaner ordering. Existing planr projects (with `.planr/config.json` already written) hit `CONTINUE` and skip Step 0 entirely, identical to v0.7.0/v0.7.1's CONTINUE path.

### Pairs with

- `openplanr` (planr CLI) v1.5.2 — unchanged
- `openplanr-skills` v1.4.0 — unchanged
- `marketplace` pin — bumped to v0.7.2 in a follow-on PR

## [0.7.1] — 2026-05-01

### Added — Greenfield bootstrap, brief interpretation, plan-mode awareness, path expansion

`/planr-pipeline:plan` now works on greenfield directories with a single natural-language brief in `$ARGUMENTS`. Four improvements, all in a new **Step 0 — Pre-flight** block (runs before mode detection + input validation):

#### 0a — Brief interpretation

`$ARGUMENTS` accepts two shapes:

1. Slug only: `support-inbox`
2. Slug + brief: `support-inbox\n\nAI-augmented customer support inbox.\nTickets auto-classified by Claude (budget cap + retry).\nStack: Next.js + Prisma + Postgres + Redis.\nMockups: ~/Designs/inbox-list.png`

When a brief is present, the auto-scaffolded SPEC body is populated from the brief content (substantive Context, Functional Requirements, Business Rules, Acceptance Criteria) instead of leaving template placeholder TODOs. The pipeline then continues straight through to subagent dispatch — no second invocation needed.

#### 0b — Path expansion (universal)

`~/foo` and `~user/foo` are expanded to absolute paths via `$HOME`. Bare relative paths resolve against the project root (working directory), not `${CLAUDE_PLUGIN_ROOT}`. Fallback to unexpanded form if expansion misses. Applied in:

- `commands/plan.md` Step 0b
- `agents/designer-agent.md` PNG resolution (now also reads `<SPEC_DIR>/design/*.png` as a first-class source)

Closes the `~/Designs/` path resolution issue users hit on greenfield projects.

#### 0c — Plan Mode awareness

When the user's Claude Code session is in **Plan Mode** (read-only research mode), the pipeline writes a markdown plan describing what it WOULD do — without bootstrapping directories, scaffolding the spec, or dispatching subagents. Ends with: *"Plan mode is active. Exit Plan Mode and re-run to execute."*

#### 0d — Greenfield directory bootstrap

When `.planr/config.json` is missing, the pipeline writes a minimal config (deriving `projectName` from `package.json#name` or the directory basename) and creates `.planr/specs/` + `input/tech/` directories. No more "no `.planr/`, no DB" failures on first run.

#### 0e — Greenfield Node project ask (CONDITIONAL)

When `package.json` is missing AND the brief implies a Node-based stack, the pipeline **asks the user explicitly** before scaffolding:

> ⚠ Greenfield directory detected. Reply "scaffold first" to bootstrap the project + dependencies, OR run create-next-app yourself and re-run.

On `scaffold first`, the pipeline runs `create-next-app`, `npm install` for declared deps, and `prisma init` — then continues to PO Phase. No surprise scaffolds without consent.

#### 0f — Stack inference from brief

When `input/tech/stack.md` is missing AND the brief mentions stack components (Next.js, Prisma, Postgres, Redis, Anthropic SDK, Vitest, etc.), the pipeline auto-authors `stack.md` from the template populated with the brief's hints. Falls back to existing self-heal (template + abort) when the brief is empty or stack-less.

### Migration

None. Existing v0.7.0 invocations (slug-only `$ARGUMENTS`, pre-existing `.planr/`) work identically. The new behaviors only fire on missing inputs or natural-language briefs.

### Pairs with

- `openplanr` (planr CLI) v1.5.1+ — unchanged
- `openplanr-skills` v1.4.0 — unchanged
- `marketplace` pin — no update needed (uses tag, not specific commit)

## [0.7.0] — 2026-04-30

### Changed — Plugin renamed to `planr-pipeline`

Plugin name: `openplanr-pipeline` → `planr-pipeline`. Slash commands: `/openplanr-pipeline:plan` → `/planr-pipeline:plan` (same for `:ship`). GitHub repo: `openplanr/openplanr-pipeline` → `openplanr/planr-pipeline` (auto-redirected by GitHub).

### Why

Brand convergence on `planr` (the CLI binary). The `openplanr-` prefix was a vestige of an earlier naming era and created cognitive friction for users typing slash commands daily — your CLI is `planr`, your slash commands now match.

### Migration

Install via:

```
/plugin install planr-pipeline@openplanr
```

The old install command (`/plugin install openplanr-pipeline@openplanr`) continues to resolve via the v0.6.1 deprecation stub which prints a one-line redirect message to the new plugin.

The plugin's behaviour is **byte-for-byte identical** to v0.6.0. Only the name changed.

### Pairs with

- `openplanr` (planr CLI) v1.5.1 — generated rule filenames + slash command references updated
- `openplanr-skills` v1.4.0 — SKILL.md routing tree aligned with the new plugin name
- `marketplace` — pin updated to v0.7.0

## [0.6.0] — 2026-04-29

### Added — OpenPlanr Protocol v1.0.0 + cross-runtime parity

The pipeline plugin is now formally **one of three runtime adapters** to the OpenPlanr Protocol. The protocol is the contract; runtimes are adapters.

**New protocol docs at `docs/protocol/`:**

- `README.md` — protocol overview, version, and the runtime-as-adapter principle
- `spec-artifacts.md` — canonical schema for SPEC, US, Task, design-spec, error-report, qa-report, `.pipeline-shipped` marker
- `agent-roles.md` — 8 named role contracts (inputs, outputs, tool guardrails, model tier)
- `commands.md` — PLAN and SHIP as runtime-agnostic command contracts (R1 normative)
- `runtime-adapters.md` — per-adapter specs for Claude Code (canonical), Cursor, Codex

**New compatibility matrix at `docs/compatibility-matrix.md`** — full per-capability parity table, including caveats around tool restrictions, Stop hook absence on Cursor/Codex, and Cursor subagent dispatch versioning.

**New `runtime` field in the `.pipeline-shipped` marker** identifies which runtime executed (`claude-code`, `cursor`, or `codex`).

### How to use it

The plugin itself doesn't change behaviour — `/openplanr-pipeline:plan` and `/openplanr-pipeline:ship` work exactly as in v0.5.0. What's new is that other runtimes can now run the same pipeline:

```bash
# Generate Cursor pipeline rules
planr rules generate --target cursor --scope pipeline

# Generate Codex AGENTS.md pipeline section
planr rules generate --target codex --scope pipeline
```

(Requires planr CLI v1.5.0+.)

### Files updated

- `docs/protocol/{README,spec-artifacts,agent-roles,commands,runtime-adapters}.md` (new)
- `docs/compatibility-matrix.md` (new)
- `.claude-plugin/plugin.json` — version 0.5.0 → 0.6.0

### Migration

No action required. The plugin's behaviour is unchanged. The new docs are reference material for users adopting Cursor or Codex alongside Claude Code.

### Pairs with

- `OpenPlanr` (planr CLI) v1.5.0 — `planr rules generate --scope pipeline` ships the Cursor + Codex adapter rules
- `openplanr-skills` v1.3.0 — SKILL.md routing tree extended to multi-runtime

## [0.5.0] — 2026-04-28

### Changed — Consolidated under `/plan` + `/ship`

The plugin's user-facing surface is now exactly two slash commands. Auxiliary skills (`init`, `snapshot`, `spec`, `review`, `stack`) have been removed; their value is delivered inline:

- **Spec scaffolding** runs inside `/openplanr-pipeline:plan` (auto-scaffolds `.planr/specs/SPEC-NNN-{slug}/` when missing).
- **CLAUDE.md snapshot** runs inside `/openplanr-pipeline:ship` Step 5.
- **Spec authoring** is owned by the planr CLI (`planr spec create + shape`) for spec-driven mode, or by direct edits to the placeholder body the pipeline scaffolds.
- **Review** is direct inspection of `.planr/specs/SPEC-NNN-{slug}/{stories,tasks}/*.md` — no command needed.
- **Stack files** live at `${CLAUDE_PLUGIN_ROOT}/stacks/` and `.claude/stacks/` — copy a default to your project to override.

### Why

Two-command surface eliminates namespace collisions with Claude Code built-ins (`/init`, `/review`) and removes redundancy with the planr CLI's spec authoring commands. Cleaner mental model: install the plugin, run `/plan`, run `/ship`.

### Files updated

- Removed `skills/{init,snapshot,spec,review,stack}/` directories
- `commands/plan.md`, `commands/ship.md` — references to the removed skills replaced with inline behaviour or direct file edits
- `templates/CLAUDE.md.tpl` — points to `/ship` for refresh
- `hooks/hooks.json` — Stop hook reminder updated
- `docs/{rules,spec-anatomy,task-anatomy,us-anatomy,pipeline-overview}.md` — references updated
- `stacks/{frontend,backend,database,devops}/*.md` — header notes point to copy-to-project pattern
- `README.md` — install + walkthrough rewritten around the two commands
- `.claude-plugin/plugin.json` — version 0.4.0 → 0.5.0

### Migration

No action required for new installs.

For projects that previously ran the deleted skills:

| Old | Replacement |
|---|---|
| `/openplanr-pipeline:init {name}` | `/openplanr-pipeline:plan {name}` (auto-scaffolds spec shell) |
| `/openplanr-pipeline:snapshot` | Runs automatically at end of `/openplanr-pipeline:ship` |
| `/openplanr-pipeline:spec {name}` | `planr spec create + shape` (planr CLI) — or fill in the auto-scaffolded body manually |
| `/openplanr-pipeline:review {name}` | Open `.planr/specs/SPEC-NNN-{slug}/{stories,tasks}/*.md` directly |
| `/openplanr-pipeline:stack {category}` | Copy `${CLAUDE_PLUGIN_ROOT}/stacks/{category}/*.md` to `.claude/stacks/{category}/` and edit |

## [0.4.0] — 2026-04-27

### Added — Self-sufficient spec scaffolding

`/openplanr-pipeline:plan {slug}` now scaffolds its own `.planr/specs/SPEC-NNN-{slug}/` directory when missing. The pipeline plugin is a complete standalone Claude Code plugin — install from the marketplace, ship features end-to-end without external dependencies.

```
# First run — scaffolds the spec shell if missing, stops for editing
/openplanr-pipeline:plan auth

# (user fills in the spec body)

# Second run — decomposes with designer + specification agents
/openplanr-pipeline:plan auth

# Ship
/openplanr-pipeline:ship auth
```

planr CLI remains the canonical surface for agile mode, quick tasks, multi-spec management (`list`, `status`, `sync`, `destroy`), and bare-CLI workflows. Both products share the v1.0.0 spec schema verbatim — specs scaffolded by the pipeline can be managed by planr CLI and vice versa.

### Added — `.pipeline-shipped` execution marker

`/openplanr-pipeline:ship` writes a YAML marker file at the end of every run, recording shipped_at, pipeline version, mode, tasks executed, QA status, and which agents were invoked.

- **Default mode:** `output/feats/feat-{name}/.pipeline-shipped`
- **Spec-driven mode:** `.planr/specs/SPEC-NNN-{slug}/.pipeline-shipped`

### Files updated

- `commands/plan.md` — auto-scaffolding logic in Step 1b
- `commands/ship.md` — marker write step in Step 5.5
- `templates/spec-driven.md.tpl` (new) — minimal v1.0.0 spec template
- `.claude-plugin/plugin.json`

### Migration

No action required. Existing `.planr/specs/` directories continue to work; the pipeline now scaffolds new ones on demand.

## [0.3.1] — 2026-04-26

### Fixed — Self-healing in spec-driven mode

When a project enters spec-driven mode via planr CLI (`planr spec init` + `planr spec create`), `.planr/specs/` is created but `input/tech/stack.md` is NOT (planr doesn't own that file). Previously, running `/openplanr-pipeline:plan {slug}` against this state aborted with "input/tech/stack.md not found", forcing the user to switch tools and run `/openplanr-pipeline:init` just to get one file.

In v0.3.1, when spec mode is active AND `input/tech/stack.md` is missing, the pipeline:

1. Copies `${CLAUDE_PLUGIN_ROOT}/templates/stack.md.tpl` to `input/tech/stack.md`
2. Prints a clear "edit and re-run" message
3. Aborts gracefully — no subagent is invoked, no source code is touched

Same self-heal behavior applies to `/openplanr-pipeline:ship` (which is even more critical since the DEV phase needs `BuildCommand`/`TestCommand` from stack.md).

**Default mode is unchanged.** Missing `stack.md` in default mode still aborts with the existing "Run `/openplanr-pipeline:init`" guidance — because there, missing stack typically means missing the entire scaffolding and `/init` is the right answer.

### Why

Coordination gap surfaced by real-world testing: planr authors specs, pipeline executes them, but neither side bootstrapped the file the pipeline requires from the user. v0.3.1 closes this gap with friendly self-heal rather than hard failure.

### Files updated

- `commands/plan.md` — Self-healing block added under Step 1b spec-mode requirements
- `commands/ship.md` — Same
- `.claude-plugin/plugin.json` — version 0.3.0 → 0.3.1

### Migration

No action required. v0.3.1 is a strict superset of v0.3.0 behavior.

## [0.3.0] — 2026-04-25

### Added — Bridge to planr spec-driven mode

The pipeline now reads `.planr/specs/SPEC-NNN-{slug}/` directly when planr's spec-driven mode is active in the project. No conversion adapter, no copy step — both products share one artifact schema.

**Detection:** If `.planr/config.json` exists AND `idPrefix.spec` is set, the orchestrator commands (`/plan`, `/ship`) switch to spec-driven mode. Otherwise they fall through to the default `output/feats/feat-{name}/` layout.

**Path mapping (default mode → spec-driven mode):**

| Concept | Default | Spec-driven |
|---|---|---|
| Feature root | `output/feats/feat-{name}/` | `.planr/specs/SPEC-NNN-{slug}/` |
| US files | `output/feats/.../us-{N}/us-{N}.md` | `<SPEC_DIR>/stories/US-NNN-{slug}.md` |
| Task files | `output/feats/.../tasks/task-{M}.md` | `<SPEC_DIR>/tasks/T-NNN-{slug}.md` |
| Design spec | `output/feats/.../design-spec.md` | `<SPEC_DIR>/design/design-spec.md` |
| Error report | `output/feats/.../tasks/error-report.md` | `<SPEC_DIR>/tasks/error-report.md` |
| QA report | `output/feats/.../qa-report.md` | `<SPEC_DIR>/qa-report.md` |

In spec-driven mode, US-NNN and T-NNN IDs are scoped to their parent SPEC (not project-globally unique). Two specs can each have their own US-001.

**Optimization:** if `<SPEC_DIR>/stories/` is non-empty (the user already ran `planr spec decompose`), `/plan` skips the specification-agent step and treats the existing decomposition as authoritative.

### Files updated

- `commands/plan.md`, `commands/ship.md` — Mode-detection block + conditional path resolution
- `agents/specification-agent.md`, `designer-agent.md`, `frontend-agent.md`, `backend-agent.md`, `qa-agent.md`, `doc-gen-agent.md` — "Path Resolution" section explaining dual-mode behavior
- `agents/db-agent.md`, `devops-agent.md` — UNCHANGED (mode-agnostic by nature)
- `templates/error-report.md` — Header documents both possible "Lives at" paths
- `README.md` — "Bridge to planr spec-driven mode" subsection added
- `.claude-plugin/plugin.json` — version 0.2.0 → 0.3.0

### Migration

**No change required** for existing projects using the default `output/feats/` layout. Detection is conservative: spec mode activates ONLY when `.planr/config.json` exists with `idPrefix.spec` set.

To opt into spec-driven mode:
1. Install planr CLI: `npm i -g openplanr` (or `npx openplanr` ad hoc)
2. In your project: `planr spec init` then `planr spec create "<title>" --slug <slug>`
3. (Optional) `planr spec shape <SPEC-id>` for guided authoring
4. (Optional) `planr spec decompose <SPEC-id>` for AI-driven US + Task generation
5. From Claude Code: `/openplanr-pipeline:plan {slug}` — pipeline picks up `.planr/specs/SPEC-NNN-{slug}/` automatically

### Why this matters

Without this bridge, planr's spec-driven mode would require a conversion step before invoking the pipeline (translate `.planr/specs/` into `output/feats/`). Sharing the schema eliminates that drift permanently — planr is the authoring surface, openplanr-pipeline is the executor, both speak the same contract.

See https://github.com/openplanr/OpenPlanr/blob/main/docs/proposals/spec-driven-mode.md for the full design.

## [0.2.0] — 2026-04-25

### ⚠️ Breaking changes — slash command rename

All slash commands were renamed to single-verb form for ergonomics. The old names no longer exist. Per pre-1.0 semver, this minor bump signals a breaking change. Update any docs or scripts referencing the old names.

| v0.1.x (removed) | v0.2.0 (new) |
|---|---|
| `/openplanr-pipeline:po-phase` | `/openplanr-pipeline:plan` |
| `/openplanr-pipeline:dev-phase` | `/openplanr-pipeline:ship` |
| `/openplanr-pipeline:shape-spec` | `/openplanr-pipeline:spec` |
| `/openplanr-pipeline:discover-stack` | `/openplanr-pipeline:stack` |
| `/openplanr-pipeline:review-tasks` | `/openplanr-pipeline:review` |

Unchanged: `/openplanr-pipeline:init`, `/openplanr-pipeline:snapshot`.

### Why

The new names compose into a clean three-verb narrative — **plan, review, ship** — that reads naturally with the plugin namespace. They also drop the redundant `-phase` and `-spec`/`-stack`/`-tasks` suffixes that were carrying no information once the namespace prefix was applied.

### Migration

If you ran `/openplanr-pipeline:init` on v0.1.x, no change is needed in your project — the `input/`, `output/`, `Docs/` structure and seeded files are unchanged. Just use the new slash command names going forward.

### Other changes
- Skill directory layout follows the new names: `skills/spec/`, `skills/stack/`, `skills/review/` (was `shape-spec/`, `discover-stack/`, `review-tasks/`).
- Subagent names (`db-agent`, `specification-agent`, etc.) are unchanged — they're internal references, never typed by users.
- Stop hook message simplified: `[openplanr-pipeline] DEV phase finished` instead of redundant `/openplanr-pipeline:ship finished`.
- Cleaned up several legacy regex artifacts in agent prompts (`${CLAUDE_PLUGIN_ROOT}/stacks/ (or .claude/stacks/...)` collapsed to `${CLAUDE_PLUGIN_ROOT}/stacks/` with cleaner override semantics described once).

## [0.1.2] — 2026-04-25

### Fixed
- `templates/CLAUDE.md.tpl` was the planr CLI's auto-generated agile-planning preamble (accidentally inherited from the source repo). Replaced with a proper pipeline-framework snapshot template covering Project Identity, Phase Status, Feature Registry, Active Agents (all 8), Build Log, Known Issues, Stack Summary. Existing project `CLAUDE.md` files are NOT touched on upgrade — `/init` is idempotent and only seeds when missing.

## [0.1.1] — 2026-04-25

### Fixed
- `plugin.json` `repository` field reverted to plain string (Claude Code plugin schema validator rejects the `{type, url}` object shape that the npm/package.json convention uses). v0.1.0 was tagged but uninstallable due to this validation error.

## [0.1.0] — 2026-04-25 (yanked — broken plugin.json schema)

### Added

- Initial plugin release.
- 8 subagents with frontmatter + tool-layer rule enforcement:
  - `db-agent` (Sonnet 4.6, READ-ONLY DB introspection — SQL + Mongo)
  - `designer-agent` (Sonnet 4.6, PNG → design-spec.md, with feature-namespaced PNG resolution)
  - `specification-agent` (Sonnet 4.6, spec → US + tasks)
  - `frontend-agent` (Opus 4.7, UI codegen, 3-iteration correction loop)
  - `backend-agent` (Opus 4.7, backend codegen + scaffold mode, 3-iteration correction loop)
  - `qa-agent` (Sonnet 4.6, DoD gate, runs build/test from stack.md)
  - `devops-agent` (Sonnet 4.6, generates docker-compose / CI / Dockerfiles — **no Bash, non-deploy enforced at tool layer**)
  - `doc-gen-agent` (Sonnet 4.6, generates `Docs/feat-{name}/`)
- 2 orchestrator commands: `/openplanr-pipeline:po-phase`, `/openplanr-pipeline:dev-phase`.
- 5 skills: `/init`, `/shape-spec`, `/discover-stack`, `/review-tasks`, `/snapshot`.
- Stack library defaults: NestJS, Next.js, Prisma, MongoDB, Docker Compose. User overrides at `.claude/stacks/` always win.
- Templates: `error-report.md` (R6 failure schema), `CLAUDE.md.tpl`, `stack.md.tpl`, `spec.md.tpl`.
- Stop hook in `hooks/hooks.json` — fires a snapshot reminder if `/dev-phase` aborts before its explicit snapshot call.
- Documentation: `docs/{rules,pipeline-overview,agent-model-map,spec-anatomy,us-anatomy,task-anatomy}.md`.

### Pipeline rules enforced

- R1 — No single PO → DEV command (separate `/po-phase` and `/dev-phase` commands; mandatory human review between).
- R3 — Model assignments fixed in subagent frontmatter.
- R6 — Max 3 correction iterations per task (in `frontend-agent` and `backend-agent` prompts).
- R8 — DB Agent READ-ONLY (enforced by `tools:` frontmatter — only read-only DB clients in Bash).

### Known limitations

- macOS / Linux / WSL only. The Stop hook uses POSIX shell.
- Live end-to-end testing against a real DB is deferred (manual verification recommended after install).
- planr ↔ pipeline bridge deferred to v0.2.
