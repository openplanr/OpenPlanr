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
| Turn verified product evidence into governed DEV, OWNER, and AGENT decisions | `planr operate ...` |
| Review local project state | `/planr-pipeline:dashboard` |
| Generate or review design artifacts | `/planr-pipeline:design`, `/planr-pipeline:design-loop`, `/planr-pipeline:design-review` |
| Decide which OpenPlanr tool to use | `openplanr` skill |
| Install or migrate certified runtimes | `planr setup` |

## Drift Rule

When a behavior touches multiple repos, update the owner first and then mirror
the references. The current owner map is in `docs/ownership-map.md`; release
order and audit commands are in `docs/release-checklist.md`.

## Guided Operating Board

The CLI owns the Operating Board questionnaire, typed answer validation,
preview, and exact next actions. Runtime skills are presentation adapters only:
they may use a verified native question tool, structured chat, an attached
terminal, or return a terminal handoff. They must never infer answers, append
`--yes`, bypass evidence recovery, or continue after a mutating/provider action
without a distinct user selection. See
[`guided-operating-board.md`](guided-operating-board.md).
