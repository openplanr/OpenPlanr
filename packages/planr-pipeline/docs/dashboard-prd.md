# PRD — planr dashboard (live GUI for the planning graph)

| | |
|---|---|
| **Status** | Draft — for review |
| **Author** | planr team |
| **Date** | 2026-06-13 |
| **Related** | `/planr-pipeline:status` · `lib/design-engine/` (board daemon) · `.planr/design-system/` · `docs/pipeline-overview.md` · the `product-showcase` canvas (Status screen = the Overview seed) |
| **One-liner** | A local, real-time web GUI that renders everything planr produces — epics, features, user stories, tasks, sprints, backlog, ADRs — as a navigable graph / board / list, kept in lockstep with `.planr/` on disk. |

---

## 1. Summary

planr produces a rich, cross-referenced hierarchy of planning artifacts as markdown in
`.planr/`. Today that graph is only legible through the CLI (text tables) or by reading files
by hand. The **dashboard** is a localhost web app that visualizes the whole graph and lets a
human *see* and *navigate* it — hierarchy and dependencies as a graph, work as a board/kanban,
detail in an inspector — updating live as the agents (and the user) change the files.

It is **read-first** (the markdown stays the single source of truth) and reuses three things
planr already has: the **delivery-status data engine** (`/status`), the **board daemon** GUI
substrate (`lib/design-engine/`), and the **design system** + the Status screen design we just
generated. It is therefore mostly *assembly*, not new infrastructure.

## 2. Problem & motivation

- **The plan is invisible.** Everything planr does well — decomposition, dependencies,
  acceptance criteria, ship status — lives in dozens of markdown files. There is no way to *see*
  the shape of a project, where work is blocked, or how a task traces up to its epic.
- **Text tables don't show structure.** `/status` answers "what's the rollup" but can't show a
  dependency graph, a kanban flow, or let you drill from an epic to a failing task in two clicks.
- **Non-CLI stakeholders are locked out.** A PM, designer, or lead who wants to glance at "what's
  shipping this sprint" shouldn't need to read frontmatter.
- **Agents move fast; humans lose the thread.** During a wide `/ship`, many tasks change state in
  parallel. A live view turns that from "tail the logs" into "watch the board."

## 3. Why now (the pieces already exist)

| Need | What already exists | What's missing |
|---|---|---|
| Project data model + rollup | CLI `delivery-status-service` (`planr status --md`), frontmatter cross-refs, mode-detection | a **JSON** emitter (`planr graph --json`) + a stable schema |
| Local web server + live reload | `lib/design-engine/{daemon,board,cli}.mjs` — serves boards, HTTP routes, `/api/reload`, sessions, auth | a `.planr/` **watch → push** channel + a dashboard app surface |
| Visual language | `.planr/design-system/` (tokens, brand, components) + the `product-showcase` Status screen (the Overview tab, already designed) | the Graph / Board / Detail views |
| Pins, export | board feedback + PNG/HTML export | (reused as-is) |

The Status screen in the `product-showcase` canvas is, by design, the dashboard's **Overview
tab**. Phase-0 design is effectively complete.

## 4. Goals / Non-goals

**Goals**
1. One command opens a live, local dashboard of the entire `.planr/` project.
2. See the **graph**: epics → features → stories → tasks, plus `dependsOn` edges, blocked paths.
3. See work as a **board/kanban** (by status, sprint, or assignee) and as **list/table**.
4. **Drill down** to any artifact's full detail (acceptance criteria, subtasks, ADRs, ship state).
5. Stay **live**: a file change in `.planr/` (agent or human) reflects in the UI within ~1s.
6. **Cross-reference** GitHub PRs / Linear issues inline (reuse the `/status` cross-ref).
7. Work **cross-runtime** (Claude Code, Cursor, Codex) and **offline** (localhost, no cloud).

**Non-goals (v1)**
- Not a replacement for the CLI or the markdown files — it **visualizes** them.
- Not a multi-user/hosted/SaaS product — single local user, single repo.
- Not authoring net-new artifacts from scratch in the GUI (that's `/plan` / the CLI).
- Write-back (editing artifacts from the GUI) is **explicitly phased out of v1** (see §13).

## 5. Users & jobs-to-be-done

| Persona | Job |
|---|---|
| **Engineer-operator** (drives the agents) | "While a wide `/ship` runs, watch which tasks are in-flight / done / blocked, and jump to a blocker." |
| **Tech lead** | "Show me the dependency graph for this feature and where the critical path is blocked." |
| **PM / stakeholder** | "What's shipping this sprint? What's outstanding? — without reading frontmatter." |
| **Designer** | "Which UI tasks are tied to which screens / design-spec sections?" |

## 6. Product overview — the views

A persistent **rail · stage · inspector** shell (the design system's app shell), with a view
switcher in the top bar:

1. **Overview** *(the Status screen we designed)* — KPIs (shipped / in-progress / blocked /
   coverage) + a sortable table of specs/features with progress, status, PR/Linear refs.
2. **Graph** — the heart of the feature. A layered DAG: epics at the top, features, stories,
   tasks; hierarchy edges (containment) + `dependsOn` edges (dependency). Nodes colored by status,
   blocked paths highlighted, click → inspector. Pan/zoom (the board engine already does this).
3. **Board / Kanban** — columns by **status** (backlog → ready → in-progress → in-review → done →
   blocked), groupable by **sprint** or **feature**. Cards = stories or tasks.
4. **List / Table** — dense, filterable, sortable; the "spreadsheet" view for bulk scanning.
5. **Sprint** — the current sprint's committed work, burn-down-style progress, carryover.
6. **Detail / Inspector** — for any selected artifact: title, body, acceptance criteria (Gherkin
   for stories), subtask checkboxes, `dependsOn`, parent chain breadcrumb, ship/QA state, PR/Linear
   links, and the related design-spec section when one exists.
7. **Operating** *(optional)* — a read-only Protocol v1.2 projection showing the
   evidence → constraint → route → outcome causal thread, owner decisions,
   evidence gaps, advisor-lens readiness, linked specs, and measured outcomes.
   Operating entities remain outside the delivery graph taxonomy.

Cross-cutting: **global search** (id / title / status), **filters** (status, sprint, feature,
assignee, label), and **deep-linkable URLs** (`#/graph?feature=FEAT-018`).

## 7. Functional requirements

**FR-1 Launch.** `/planr-pipeline:dashboard [--port N] [--open] [--no-watch]` resolves mode
(`mode-detection.md`), starts the local server, prints `DASHBOARD_URL:`, and (optionally) opens it.
Re-running reuses a live server (like the board daemon). Read-only by default.

**FR-2 Data load.** On start, build the project graph (FR-7). Empty `.planr/` → an honest empty
state with a one-line next action (`Run /planr-pipeline:plan <feature>`), never a blank screen.

**FR-3 Graph view.** Render hierarchy + dependency edges; node = artifact (typed, status-colored);
clicking a node opens it in the inspector and highlights its parent chain + dependents. Collapse a
subtree; filter to one epic/feature. A blocked task and everything transitively waiting on it are
visibly marked.

**FR-4 Board view.** Cards in status columns; group-by **status | sprint | feature**; counts per
column; click → inspector. (Drag-to-move is **read-only-disabled** in v1 — see §13.)

**FR-5 List/Table & Overview.** Sort/filter by any column; Overview matches the `/status` rollup
numbers exactly (same engine — FR-9).

**FR-6 Detail.** Full artifact render incl. acceptance criteria, subtask checkbox progress,
`dependsOn`, parent breadcrumb, ship marker / QA gate state, GitHub/Linear refs, related
design-spec section.

**FR-7 Graph model.** Nodes: `epic | feature | story | task | spec | backlog | quick | sprint | adr`.
Edges: `contains` (hierarchy from frontmatter parent ids) and `depends_on` (from `dependsOn`).
Status taxonomy reuses `/status`'s classify rules (done / addressed / outstanding) + finer
in-progress/blocked from markers and checkbox counts.

**FR-8 Live sync.** Watch `.planr/`; on change, recompute the affected subgraph and push to the
browser; the UI updates in place (≤1s p95) without losing the user's current view/selection.

**FR-9 One engine, one truth.** Data comes from the planr CLI when present
(`planr graph --json` / `planr status --json`), else a native frontmatter reader — mirroring
`/status` A.1/A.2 so the dashboard and the CLI can never disagree (see §11).

**FR-10 Cross-reference.** Surface `githubIssue` / `linearIssueIdentifier` from frontmatter; when
`gh` is authenticated, best-effort correlate PRs (labelled best-effort), exactly as `/status` does.

**FR-11 Export / share.** Export the current view (graph or board) to PNG/HTML via the existing
board export, for embedding in updates or, yes, a showcase video.

## 8. Information architecture & UX

- Shell = the design system's **rail (Pipeline / Delivery nav) · stage (the active view) ·
  inspector**, dark-first, one indigo accent, AA throughout (the `product-showcase` design).
- **Entity → visual mapping:** epic = group/swimlane; feature = card cluster / graph branch;
  story = card; task = leaf node / sub-row; sprint = board lane / time filter; ADR = inspector
  side-panel reference.
- **Status → color:** done `--success`, in-progress `--info`, blocked `--warning`, fail/error
  `--destructive`, idle `--muted` — the same semantics the showcase already uses.
- The Overview, Ship, and Status screens in the `product-showcase` canvas are the working
  prototypes for three of these surfaces.

## 9. Data model (read path)

```
Node  { id, type, title, status, progress?, sprint?, assignee?, labels[],
        parentId?, path, body?, acceptance?, github?, linear?, designSpecRef? }
Edge  { from, to, kind: "contains" | "depends_on" }
Graph { project, generated_at, nodes[], edges[], summary{ byStatus, byType } }
```

Sourced from: `.planr/{epics,features,stories,tasks,specs,backlog,quick,sprints,adrs}/*.md`
frontmatter (`id`, `title`, `status`, `storyId`/`featureId`/`epicId`, `dependsOn`, sprint, refs)
+ `.pipeline-shipped` markers + checkbox counts. A JSON Schema for `Graph` lives under
`schemas/` so the CLI emitter and the plugin fallback validate against one contract.

## 10. Architecture & technical approach

- **Home:** a `/planr-pipeline:dashboard` command (this repo) + a dashboard server under
  `lib/dashboard/` (or an extension of `lib/design-engine/daemon.mjs`). The **GUI substrate is the
  plugin**; the **data engine is the CLI**.
- **Data:** delegate to `planr graph --json` when the CLI is installed & new enough (the
  deterministic engine, extending `delivery-status-service`); otherwise a native frontmatter
  reader in the plugin (the same pattern `/status` uses, so they can't drift). Output validated
  against the `Graph` schema.
- **Server:** reuse the board daemon's HTTP server, port handling, auth, and `BOARD_URL`-style
  printout. New routes: `GET /api/graph` (the `Graph` JSON), `GET /api/node/:id` (detail),
  `GET /api/events` (SSE), and the static dashboard app.
- **Client:** the design-system shell + views, rendered with the same vendored React the canvas
  uses (offline, no CDN). Graph layout via a small **vendored** layered-DAG/force layout lib.
- **Live sync:** a debounced `.planr/` file-watcher → recompute affected nodes → SSE push;
  client patches its store and re-renders without losing view state. (`/api/reload` already exists
  as the coarse fallback.)
- **Security/footprint:** localhost only, no outbound calls except the explicit GitHub/Linear
  cross-ref the user already opts into; everything offline-capable.
- **Cross-runtime:** Node-based; works wherever the board daemon already runs (Claude Code /
  Cursor / Codex).
- **Performance:** target smooth interaction up to ~1k nodes; graph virtualization / subtree
  collapse beyond that; incremental recompute on watch events, never a full rescan per keystroke.

### 10.1 Lineage — the same live-board mechanism as design-review, repurposed

The dashboard is the **same live-board engine** the designer/design-review loop uses to take
design feedback — repurposed from *editing a design* to *tracking a project*. Same substrate, same
premium look; the difference is the **direction of the live loop**.

| | design-review loop | dashboard |
|---|---|---|
| **Substrate** | board daemon — local web server, live reload, sessions, export | **same** board daemon |
| **Look** | design system · rail · stage · inspector | **same** design system |
| **What's served** | a generated design artifact (HTML / canvas) | the project graph (status + tracking data) |
| **Data source** | the design files | the delivery-status engine + `.planr/` frontmatter |
| **Realtime trigger** | human **pins** a region → agent **regenerates** that screen → reload | **file-watch**: `.planr/` changes (agent or user) → SSE push → UI updates in place |
| **Human input loop** | pins/feedback **drive regeneration** of the artifact | v1 is **read-only**; the analog is **M4 write-back** — a GUI action → surgical markdown edit → reflected back |

So: a premium dashboard for status & tracking, built on the proven live-board substrate — read-first
(data → visualize live), with the pin-style "act on it" loop arriving as write-back in M4.

## 11. Real-time sync (detail)

1. Watch `.planr/**/*.md` + `.pipeline-shipped` markers (debounce ~150ms; ignore `.lock`, temp).
2. On a batch, re-read only changed files, recompute their nodes + touched edges, diff against the
   in-memory graph.
3. Push a minimal patch over SSE (`{ upserted:[…], removed:[…], summary }`).
4. Client applies the patch; current view, zoom, selection, and filters are preserved.

## 12. Write-back (Phase 2 — out of v1, designed-for)

Editing artifacts from the GUI (drag a card to a new status, check a subtask, re-point a
`dependsOn`) is high-value but is the genuinely hard part: round-tripping into human-authored
markdown without clobbering formatting or fighting an agent that's mid-edit. v1 ships read-only;
v2 introduces it behind: a **single-writer lock** (the same advisory-lock pattern `/design` uses),
**surgical frontmatter edits** (touch only the changed field, preserve body/format), **optimistic
UI with honest rollback** on write failure, and a clear "who owns this file right now" signal so a
running `/ship` and the GUI never collide.

## 13. Phasing / milestones

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 — Design** ✅ | Overview/Ship/Status screens + design system | done (`product-showcase` canvas) |
| **M1 — Read-only core** | command + server + `Graph` JSON (native + CLI delegate) + Overview + List + Detail | open the dashboard, browse the whole project, numbers == `/status` |
| **M2 — Graph + Board** | DAG graph view (hierarchy + dependsOn, blocked paths) + kanban (status/sprint/feature) + filters/search | navigate by structure; group/filter; deep links |
| **M3 — Live** | `.planr/` watch → SSE → in-place updates | change a file → UI reflects ≤1s, no view loss |
| **M4 — Write-back** | drag-to-move + subtask toggle, single-writer, surgical edits | a GUI edit safely round-trips to markdown + survives a concurrent `/ship` |

## 14. Success metrics

- **Time-to-first-insight:** "what's blocked?" answered in <10s without reading a file.
- **Adoption:** dashboard opened in ≥1 of every N pipeline sessions (set baseline after M1).
- **Fidelity:** Overview numbers match `/status` 100% (regression-tested against the CLI).
- **Liveness:** p95 file-change → UI update ≤1s on a representative `.planr/`.
- **No drift:** zero discrepancies between `planr graph --json` and the native fallback in
  conformance tests.

## 15. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Data drift** (GUI ≠ CLI) | one engine via `--json` delegate; native fallback validated against the same schema; conformance test compares both. |
| **Write-back corrupts markdown** | deferred to M4; single-writer lock + surgical frontmatter edits + rollback. |
| **Graph unreadable at scale** | subtree collapse, filter-to-feature, virtualization beyond ~1k nodes. |
| **Watcher thrash during wide `/ship`** | debounce + incremental recompute + minimal SSE patches. |
| **Cross-runtime gaps** | build on the board daemon, which already runs cross-runtime; no runtime-specific APIs. |
| **Scope creep into SaaS** | explicit non-goal; localhost, single-repo, no auth/hosting in v1. |

## 16. Open questions

- **Command vs flag:** standalone `/planr-pipeline:dashboard`, or `/planr-pipeline:status --serve`?
  (Leaning standalone — it's an interactive surface, not a report.)
- **CLI ownership:** does `planr graph --json` land in the CLI now (preferred), or does the plugin
  ship the native reader first and the CLI catches up?
- **Graph layout lib:** which vendored layout (layered DAG vs force) best fits hierarchy+deps?
- **Write-back demand:** is read-only enough for the first release, or is drag-to-move a launch
  requirement? (Recommend read-only launch.)
- **Sprint semantics:** how much of sprint/velocity to surface in v1 vs defer.

## 17. Out of scope (v1)

Authoring new artifacts in the GUI · multi-user/hosted/cloud · mobile-native app · AI features
inside the dashboard (it visualizes; the agents plan) · write-back (M4).

## 18. Appendix — decomposition & command surface

**Command:** `/planr-pipeline:dashboard [--port N] [--open] [--no-watch] [--view graph|board|list]`
— delegates to `planr dashboard` when the CLI provides it, else serves natively. Read-only.
Prints `DASHBOARD_URL:` and stops (the server keeps running); never auto-chains.

**Likely decomposition** (for `/planr-pipeline:plan` or the openplanr CLI):
- **Epic:** "Visual project dashboard."
  - **Feature:** Graph data engine (`Graph` schema + `planr graph --json` + native fallback).
  - **Feature:** Dashboard server (routes, SSE watch, on the design-engine daemon).
  - **Feature:** Views — Overview, Graph, Board/Kanban, List, Detail/Inspector.
  - **Feature:** Live sync (watch → patch).
  - **Feature:** Write-back (M4, separate epic candidate).

**Relationship to existing surfaces:** the dashboard is the *interactive* sibling of `/status`
(same data) and a new *app* on the same daemon as `/design-loop` / `/design-review`. Nothing here
revives sandboxing or changes the SPEC-014 dispatch contract.
