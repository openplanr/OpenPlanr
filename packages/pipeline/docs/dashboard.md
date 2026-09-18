# `/planr:dashboard`

> This document describes the current unified OpenPlanr React dashboard and its
> loopback-only planr-pipeline server contract.

> Launch the local planr dashboard — a live, read-only visual projection of the
> `.planr/` graph (Overview · Graph · Board · List · Sprints · Activity) and
> the optional read-only Operate runtime projection.

## Synopsis

```
/planr:dashboard [--port N] [--open] [--no-watch] [--view graph|board|list]
```

The command starts (or reuses) a **persistent localhost HTTP server** for the
current project, prints a single `DASHBOARD_URL:` line, and exits. The server is
**independent of the agent** (hard rule 14): once the URL is printed the command
STOPS — the server keeps serving in the background and the agent never blocks on
it. The standalone dashboard is a **read-only** surface; it never writes to
`.planr/`. When the real OpenPlanr process injects its process-local governed
command gateway, the browser can request previews and confirmations, but it
still cannot write project files or reach a provider, executor, connector, or
target directly.

The dashboard is **standalone**. It NEVER runs the PO phase or the
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

**Graph sourcing — delegate-or-fallback (same engine as `/planr:status`).**
The graph data path is `lib/dashboard/graph-engine.mjs`, which mirrors the
`/planr:status` A.1/A.2 contract so the two surfaces can never drift
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
`GET /api/meta`, `GET /api/events` (Planning SSE), the access-safe Operate routes
described below, `GET /health`, and static serving from the unified OpenPlanr
dashboard build (`dist/dashboard`, resolved by
`lib/dashboard/resolve-packaged-dashboard-root.mjs`). It
writes a discovery port file and a PID file under
`<planrHome>/dashboard-daemon/`. On a second launch on the same port, preflight
probes `GET /health`; if a live server answers `{ ok: true }` it **reuses** that
server rather than binding a second one (no `EADDRINUSE`).

**Bootstrap query roots.** `GET /api/bootstrap` returns closed, owner-issued
`queryRoots` for `planning` and `operate`. Either product root may be `null`.
A non-null root contains exactly `actorId`, `projectId`, `scopeId`, `domainId`,
`domainVersion`, and `generation`, and is bound to the bootstrap's current
project. The browser must invalidate derived queries when any root identity
changes; it must not infer a missing root, borrow the other product's root, or
substitute a sibling checkout.

**The `DASHBOARD_URL:` printout.** The command emits exactly one line:

```
DASHBOARD_URL: http://localhost:<port>/
```

When `--view` is supplied, `?view=<value>` is appended. The command is complete
the moment that line is printed.

## Relationship to `/planr:status`

The dashboard and `/planr:status` use the **same data path** and the
**same classification rules**. `/planr:status` (see `commands/status.md`,
sections A.1/A.2) composes a text report; the dashboard is the **live visual
projection** of that same graph. Status classification — `done`
(`done|closed|completed|shipped|released`), `addressed` (`promoted|superseded`),
`blocked`, `in-progress`, otherwise `outstanding` — is computed identically in
both surfaces. Anything `/status` reports, the dashboard renders, and vice versa.

## Read-only guarantee

The dashboard **never writes to `.planr/` directly**. The graph engine and file
watcher only read and observe. A standalone server has no command gateway and all
command routes fail with `OPERATE_READ_ONLY`. When OpenPlanr supplies the gateway,
the server forwards only an opaque runtime-issued action reference or a confirmed
preview digest. The OpenPlanr runtime remains the sole mutation and authority
boundary.

## Operate runtime module

When `.planr/operate/projections/runtime-state.json` and its checkpoint are
present and validate as Protocol 2.0, the rail exposes **Operating**. The view
shows only durable cycle, assignment, submission, artifact, and event-head
metadata. It is a read-only status projection; it never replays events, repairs
checkpoints, dispatches agents, or offers mutation commands.

Missing, stale, or invalid runtime state produces an explicit status rather than
a repair path. Evidence bodies, prompts, credentials, machine paths, and raw
agent responses are never included. The legacy technical module remains at
`GET /api/operate`; the product experience never derives authority or re-ranks
Today from it.

## Operate product read API

OpenPlanr supplies one canonical `operate-experience-view` that is already bound
to an actor, scope, domain, domain version, access level, and validated Event
head. The dashboard reads that public projection only; it never opens raw
Artifacts or rebuilds access decisions. The default local handoff path is
`.planr/operate/projections/experience-view.json`.

The loopback-only read routes issue owner-selected results from that one view.
Today, Inbox, Cycles/Cycle, and audit reads use their corresponding verified
display envelopes; the browser must validate the complete envelope before
presenting it:

| Route | Result |
|---|---|
| `GET /api/operate/today` | Contract-ranked attention and metrics, the active cycle with assignments/gates/dependencies/blockers, persistent Actions, Outcomes, and runtime-provided allowed actions. |
| `GET /api/operate/inbox?projectId=...&generation=...` | Owner-issued Decision, Approval, and Verification Inbox rows plus exact governed action locators or safe unavailable reasons. |
| `GET /api/operate/cycles` | Visible cycles with seven-stage inputs/outputs, gaps, uncertainty, persistent work, and replay checkpoints. |
| `GET /api/operate/cycles/:cycleId` | One exact scope-local rich cycle. |
| `GET /api/operate/evidence?cycleId=...` | Access-safe Evidence and Claims with support/contradiction, provenance, confidence, gaps/errors, causality, and rationale nodes. |
| `GET /api/operate/evidence/:subjectId?cycleId=...` | One exact Evidence or Claim subject from the same access-safe projection. |
| `GET /api/operate/outcomes?cycleId=...` | Typed metrics, execution/rollback/verification state, Outcomes, and Learnings. |
| `GET /api/operate/outcomes/:outcomeId?cycleId=...` | One typed Outcome and its Learnings. |
| `GET /api/operate/history?cycleId=...` | Ordered access-safe event history plus replay/checkpoint parity proof. |
| `GET /api/operate/search?cycleId=...&q=...` | Search over an explicit allowlist of access-safe projected strings and IDs; restricted bodies, identities, error context, and raw locators are never indexed. |
| `GET /api/operate/export?cycleId=...&format=json\|html` | A no-store audit export of the same access-safe metrics, cycles, Evidence/Claims, Outcomes, History, and replay proof, with command controls and the actor binding omitted. |
| `GET /api/operate/events?generation=...&surface=today\|inbox` | Ordered snapshot/live-patch SSE stream for one exact live display surface; Inbox SSE also requires `projectId`. |

Every route requires the actor in the `X-OpenPlanr-Actor` request header plus
`scopeId`, `domainId`, and `domainVersion` query parameters. All four values must
exactly match the supplied view. Actor and approval identities are never accepted
in URLs. Missing or substituted bindings fail before any surface data is returned.
Inbox and Inbox SSE additionally require the exact current `projectId`; Inbox
and every SSE request require a non-negative safe-integer `generation`.
Every Evidence, Outcomes, Outcome-detail, History, Search, and Export request
also requires one exact `cycleId`. Missing, duplicated, malformed, noncanonical,
or separator-bearing bindings fail before provider access; an unknown or foreign
Cycle fails closed during owner selection before surface data is returned.
Responses use `Cache-Control: no-store` and carry the same `eventHead`, `viewHash`,
status, reason codes, ordering, and subject values used by CLI JSON and agent
clients. These GET routes contain no mutation path.

The surface selector is deliberately shallow: it groups fields already certified
by the installed `operate-experience-view` contract and does not reinterpret
metrics, evidence access, causality, rankings, authority, or replay. Browser REST
and SSE, CLI human/JSON, and agent-native reads therefore share the same typed
records. Evidence or Claim bodies and producer identities that the canonical
projection marks restricted stay absent; exports and search cannot recover them.

The live stream emits an initial `snapshot` with an opaque checkpoint in the SSE
`id`. A reconnect sends that checkpoint as `Last-Event-ID`. An exact current
checkpoint returns `ready`; a retained contiguous chain returns validated public
`operate-experience-live-patch` records in order. An invalid checkpoint is
refused. A missing patch, gap, fork, changed binding, or invalid projection emits
`stale`, keeps validated read-only data useful, reports `OPERATE_EVENT_GAP` or
`OPERATE_PROJECTION_UNAVAILABLE`, and sets `mutationEnabled: false` until the
client refreshes a validated snapshot.

## Governed local command API

OpenPlanr may inject one process-local gateway into the loopback server. The
browser then uses this three-step exchange:

```bash
planr operate dashboard <cycleId> --actor <authorizedActorId>
```

That OpenPlanr-owned command activates the actor-bound gateway in-process and
prints the loopback command-center URL. Starting the standalone pipeline
dashboard keeps every command route read-only.

| Route | Exact browser input | Result |
|---|---|---|
| `POST /api/operate/session` | `cycleId` | Short-lived session capability plus opaque references for the current runtime-issued writable actions. |
| `POST /api/operate/commands/preview` | `sessionId`, `actionReference` | Canonical preview bound to actor, scope, domain version, subject revision, Event head, authority, consequence, and expiry. |
| `POST /api/operate/commands/confirm` | `sessionId`, `previewId`, `previewHash` | The refreshed durable access-safe projection, or explicit uncertainty/recovery state. Raw runtime receipts are never returned. |

All three routes require the exact actor/scope/domain/domain-version binding used
by the read API and an exact loopback `Origin` matching `Host`. Preview and confirm
also require the unguessable capability in `Authorization: Bearer ...`. Request
bodies are JSON, limited to 32 KiB, reject duplicate or unknown fields, and use
`Cache-Control: no-store` responses.

The browser never submits a capability grant, executor, connector, operation ID,
approval set, target, precondition, payload, effect class, or widened argument.
Those values remain inside the canonical allowed action and governed runtime.
Confirmation re-resolves the current actor authority, Event head, target
preconditions, policy, approvals, expiry, and exact arguments. Automatic
reconciliation after acknowledgement loss and creation of verification work stay
inside governed execution; a terminal uncertain result is never blindly retried.
An OpenPlanr restart revokes browser sessions while preserving durable
project-local state and replay results.

## Empty state

A fresh project with no specs/stories/tasks yields an empty graph
(`{ nodes: [], edges: [] }`). The dashboard renders an honest **empty state** —
a brand mark, a short message, and a command chip pointing at the next step
(`/planr:plan`) — rather than a blank canvas or an error.

## Live sync

Unless `--no-watch` is passed, the server starts a `.planr/` file watcher
(`lib/dashboard/watcher.mjs`). It debounces bursts of saves into a single
recompute, diffs the result against the in-memory snapshot, and pushes a minimal
patch over the `/api/events` SSE stream. The same watcher observes the public
experience projection and emits only contract-owned contiguous patches over
`/api/operate/events`. The client merges each patch in place,
**preserving the active view, zoom, selection, and filters** — live updates never
reset your place. The watcher is strictly read-only.

## Export

The Graph and Board views are rendered with the project's board engine, which
provides PNG and HTML export of the current view. The PNG is a reference image of
the rendered frame; the HTML/spec export is the portable handoff artifact. Export
is a read action — it never writes back into `.planr/`.

## Operate target product certification

The release target is certification against the 13 approved dashboard screens,
not a separate demo. The final real Chromium matrix must cover Start, Today in
both domains, Cycles, Decision and Approval Inbox, governed Action preview and
recovery, Evidence, Outcomes/Learnings, History, Planning handoff and origin,
and browser/CLI/agent continuation in light and dark at 1440, 1024, 390, and
320 pixels. The same runs assert 44-pixel mobile targets, no horizontal
overflow, visible keyboard focus, dialog focus containment and restoration,
screen-reader names and live regions, reduced motion, restricted-data absence,
long hostile strings, and honest stale/offline/read-only/conflict/partial states.

The target five deterministic representative sessions cover first use and attention,
Decision comprehension, named-party approval and safe Action, Planning handoff,
evidence/Outcome understanding, domain parity, navigation, support, and the
less-than-one-page instruction target. Their machine-readable inventory is in
`tests/dashboard/operate-product-usability-fixtures.mjs`; final dashboard
conformance must require the exact approved screen order and released source
ownership.
