# OpenPlanr Ecosystem Guide

OpenPlanr is intentionally split into focused repos:

- **OpenPlanr is the dedicated planning control plane.** The `planr` CLI owns
  project/portfolio planning, artifact lifecycle, setup, runtime routing, and doctor.
- **planr-pipeline is the complete delivery workflow.** It owns feature-local
  PO planning, Design, Review, DEV, QA, protocol schemas, boards, and conformance.
- **skills provide reusable workflows.** They route planning and delivery intent
  without embedding runtime-specific model instructions.
- **marketplace publishes metadata.** It owns Claude Code metadata and the
  resolved cross-runtime `ecosystem.json` compatibility manifest.

## Which Surface To Use

| User intent | Surface |
|---|---|
| Create epics, features, stories, tasks, sprints, or backlog | `OpenPlanr` CLI |
| Shape or decompose a spec for agent execution | `OpenPlanr` CLI or `/planr-pipeline:plan` |
| Move a feature through PO, Design, DEV, and QA | `planr pipeline ...` |
| Review local project state | `/planr-pipeline:dashboard` |
| Generate or review design artifacts | `/planr-pipeline:design`, `/planr-pipeline:design-loop`, `/planr-pipeline:design-review` |
| Decide which OpenPlanr tool to use | `openplanr` skill |
| Install or migrate certified runtimes | `planr setup` |

## Drift Rule

When a behavior touches multiple repos, update the owner first and then mirror
the references. The current owner map is in `docs/ownership-map.md`; release
order and audit commands are in `docs/release-checklist.md`.
