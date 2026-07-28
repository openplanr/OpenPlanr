# `/planr-pipeline:dashboard`

> Launch the local planr dashboard — a live, read-only visual projection of the
> `.planr/` graph (Overview · Graph · Board · List · Sprints · Activity) and
> the optional read-only Operating Board projection.

## Synopsis

```
/planr-pipeline:dashboard [--port N] [--open] [--no-watch] [--view graph|board|list]
```

The command starts (or reuses) a **persistent localhost HTTP server** for the
current project, prints a single `DASHBOARD_URL:` line, and exits. The server is
**independent of the agent** (hard rule 14): once the URL is printed the command
STOPS — the server keeps serving in the background and the agent never blocks on
it. The dashboard is a **read-only** surface; it never writes to `.planr/`.

The dashboard is **additive and standalone**. It NEVER runs the PO phase or the
DEV phase and it never auto-chains; it only resolves the mode, negotiates a port,
starts or reuses the server, prints the URL, and exits.

## Flags

| Flag | Meaning | Default |
|------|---------|---------|
| `--port N` | Bind to TCP port `N` on `127.0.0.1`. | env `DASHBOARD_PORT`, else `7473` |
| `--open` | After printing the URL, open it in the default browser. | off |
| `--no-watch` | Do not start the `.planr/` file watcher (serve a static snapshot, no live sync). | watcher on |
| `--view graph\|board\|list` | Append `?view=<value>` to the printed URL so the dashboard opens on that view. | server default (`overview`) |

Unknown flags are a fatal error (see `procedures/fatal-error-format.md`).

## How it works

**Mode resolution.** Preflight resolves the project mode via
`procedures/mode-detection.md`. Spec-driven (`.planr/specs/SPEC-NNN-*/`) and
default (agile `.planr/epics|features|stories|tasks/`) layouts are both
first-class; the dashboard reads whichever is present. The graph carries both the
agile model (`epic` / `feature` / `story` / `task`) and the spec model (`spec` /
`story` / `task`) node types.

**Graph sourcing — delegate-or-fallback (same engine as `/planr-pipeline:status`).**
The graph data path is `lib/dashboard/graph-engine.mjs`, which mirrors the
`/planr-pipeline:status` A.1/A.2 contract so the two surfaces can never drift
("one engine, one truth"):

- **A.1 — delegate:** when the planr CLI is installed AND new enough, the engine
  shells out to `planr graph --json` (preferred) or `planr status --json`, parses
  stdout, and validates the result against `schemas/v1.0.0/graph.schema.json`.
- **A.2 — fallback:** otherwise the native frontmatter reader
  (`lib/dashboard/graph-reader.mjs`) walks `.planr/` on disk and produces an
  equivalent, schema-valid graph.

Both paths return the identical `{ nodes, edges }` shape; the conformance suite
asserts node-id and edge-set equivalence between them.

**Server lifetime.** The server (`lib/dashboard/server.mjs`) binds on
`127.0.0.1:<port>` and registers `GET /api/graph`, `GET /api/node/:id`,
`GET /api/meta`, `GET /api/events` (SSE), `GET /health`, and static serving from
`lib/dashboard/app/`. It writes a discovery port file and a PID file under
`<planrHome>/dashboard-daemon/`. On a second launch on the same port, preflight
probes `GET /health`; if a live server answers `{ ok: true }` it **reuses** that
server rather than binding a second one (no `EADDRINUSE`).

**The `DASHBOARD_URL:` printout.** The command emits exactly one line:

```
DASHBOARD_URL: http://localhost:<port>/
```

When `--view` is supplied, `?view=<value>` is appended. The command is complete
the moment that line is printed.

## Relationship to `/planr-pipeline:status`

The dashboard and `/planr-pipeline:status` use the **same data path** and the
**same classification rules**. `/planr-pipeline:status` (see `commands/status.md`,
sections A.1/A.2) composes a text report; the dashboard is the **live visual
projection** of that same graph. Status classification — `done`
(`done|closed|completed|shipped|released`), `addressed` (`promoted|superseded`),
`blocked`, `in-progress`, otherwise `outstanding` — is computed identically in
both surfaces. Anything `/status` reports, the dashboard renders, and vice versa.

## Read-only guarantee

The dashboard **never writes to `.planr/`**. The server, the graph engine, and
the file watcher only read and observe; there is no write-back path (drag-to-move
on the Board and inline edit on the Detail view are out of scope for this
release). You can run the dashboard against a working tree without any risk of it
mutating your planning artifacts.

## Operating Board module

When `.planr/operate/projections/state.json` exists and passes Protocol v1.2
validation, the rail exposes **Operating**. This view presents the current
evidence → constraint → route → outcome thread, open owner decisions, evidence
gaps, linked delivery specs, outcome state, and the six bounded advisory lenses
(CEO, CTO, CPO, CMO, COO, and Chair).

The module is a disposable projection, not an operating-state engine. It never
replays events, repairs checkpoints, accepts findings, or applies routes.
Mutation affordances are exact CLI handoffs such as
`planr operate review CYCLE-001`. Missing, stale, or invalid state degrades to a
specific recovery command; the browser does not attempt a repair.

Evidence bodies, prompts, credentials, machine paths, and raw provider responses
are never included. The server exposes only `GET /api/operate` for this module.

## Empty state

A fresh project with no specs/stories/tasks yields an empty graph
(`{ nodes: [], edges: [] }`). The dashboard renders an honest **empty state** —
a brand mark, a short message, and a command chip pointing at the next step
(`/planr-pipeline:plan`) — rather than a blank canvas or an error.

## Live sync

Unless `--no-watch` is passed, the server starts a `.planr/` file watcher
(`lib/dashboard/watcher.mjs`). It debounces bursts of saves into a single
recompute, diffs the result against the in-memory snapshot, and pushes a minimal
patch over the `/api/events` SSE stream. The client merges each patch in place,
**preserving the active view, zoom, selection, and filters** — live updates never
reset your place. The watcher is strictly read-only.

## Export

The Graph and Board views are rendered with the project's board engine, which
provides PNG and HTML export of the current view. The PNG is a reference image of
the rendered frame; the HTML/spec export is the portable handoff artifact. Export
is a read action — it never writes back into `.planr/`.
