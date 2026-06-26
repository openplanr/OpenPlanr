# OpenPlanr Ecosystem Guide

OpenPlanr is intentionally split into focused repos:

- **OpenPlanr plans.** The `planr` CLI owns agile planning, spec authoring,
  generated runtime rules, and planning-side project structure.
- **planr-pipeline ships.** The Claude Code plugin owns execution, protocol
  schemas, conformance, the dashboard, and the design board.
- **openplanr skill routes.** The skill explains which surface to use for a
  user request: CLI planning, plugin execution, generated Cursor/Codex rules, or
  bare artifact work.
- **marketplace installs.** The marketplace repo owns Claude Code install
  metadata and points users at released plugin and skill versions.

## Which Surface To Use

| User intent | Surface |
|---|---|
| Create epics, features, stories, tasks, sprints, or backlog | `OpenPlanr` CLI |
| Shape or decompose a spec for agent execution | `OpenPlanr` CLI or `/planr-pipeline:plan` |
| Execute reviewed tasks in Claude Code | `/planr-pipeline:ship` |
| Review local project state | `/planr-pipeline:dashboard` |
| Generate or review design artifacts | `/planr-pipeline:design`, `/planr-pipeline:design-loop`, `/planr-pipeline:design-review` |
| Decide which OpenPlanr tool to use | `openplanr` skill |
| Install Claude Code surfaces | `marketplace` |

## Drift Rule

When a behavior touches multiple repos, update the owner first and then mirror
the references. The current owner map is in `docs/ownership-map.md`; release
order and audit commands are in `docs/release-checklist.md`.
