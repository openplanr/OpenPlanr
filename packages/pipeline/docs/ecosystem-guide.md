# OpenPlanr Ecosystem Guide

OpenPlanr is organized as focused domains in one npm workspace:

- **`packages/cli` is the dedicated planning control plane.** The `planr` CLI owns
  project/portfolio planning, artifact lifecycle, setup, runtime routing, and doctor.
- **`packages/pipeline` is the public delivery package.** It owns feature-local
  PO planning, Design, Review, DEV, QA, and self-contained compatibility projections.
- **`packages/protocol` owns schemas and registries.** Public packages receive
  generated, self-contained projections rather than runtime private-package dependencies.
- **`skills/`, `agents/`, and `packages/skill-runtime` own workflow sources and composition.**
  Generated runtime projections live under `adapters/` and the pipeline package.
- **Root marketplace metadata publishes generated host compatibility.** It is
  a workspace projection, not a separate source repository.
- **openplanr-web is the independently deployed hosted surface.** It owns the
  public web property plus opaque share/live-room transport while mirroring the
  pipeline's canonical artifact and cryptographic contracts.

`ecosystem.json` records the workspace package paths, versions, catalogs, and
adapter projections. Generate it from the repository root and use
`npm run check:generated` to detect drift.

## Which Surface To Use

| User intent | Surface |
|---|---|
| Create epics, features, stories, tasks, sprints, or backlog | `OpenPlanr` CLI |
| Shape or decompose a spec for agent execution | `OpenPlanr` CLI or `/planr-pipeline:plan` |
| Move a feature through PO, Design, DEV, and QA | `planr pipeline ...` |
| Review local project state | `/planr-pipeline:dashboard` |
| Generate or review design artifacts | `/planr-pipeline:design`, `/planr-pipeline:design-loop`, `/planr-pipeline:design-review` |
| Serve a hosted review shell or opaque encrypted room transport | `openplanr-web` |
| Decide which OpenPlanr tool to use | `openplanr` skill |
| Install or migrate certified runtimes | `planr setup` |

## Drift Rule

When behavior crosses domains, update the canonical owner first and regenerate
its projections. The current owner map is in `docs/ownership-map.md`; release
order and audit commands are in `docs/release-checklist.md`.

## Guided interaction

The CLI owns questionnaires, typed answer validation, previews, and exact next
actions. Runtime skills are presentation adapters only: they may use a verified
native question tool, structured chat, an attached terminal, or return a
terminal handoff. Schema 1.1 questionnaires include the exact bounded-stdin
submission contract, so adapters never reconstruct envelope metadata. They
must never infer answers, append `--yes`, or continue after a
mutating/provider action without a distinct user selection. See
[`protocol/guided-interactions.md`](protocol/guided-interactions.md).
