# OPERATE-SPEC-008 — Agent-native, cross-runtime Operating Board

Release participant: `openplanr@1.21.0`

Contract dependency: `planr-pipeline@0.37.0` / Protocol v1.4.0.

## Scope

OpenPlanr is the deterministic governance kernel for the SPEC-005 Operating
Board. It binds a cycle to one selected runtime, validates research claims and
advisor results, records event/checkpoint/provenance state, persists rich
Markdown and JSON reports, and materializes reversible canonical proposal
drafts. Runtime agents—not the CLI—research the workspace and reason as CEO,
CTO, CPO, CMO, COO, and Chair.

## Required behavior

- Bare `planr operate` exposes the runtime-native workflow contract.
- Local research is automatic; connected research requires consent.
- Runtime binding is sticky and cross-vendor fallback is forbidden.
- Codex advisory isolation is reported honestly as `runtime-governed`, not
  rejected as unsupported.
- `harness prepare|record|finalize|resume|cancel` is the machine lifecycle;
  `adapter` remains a two-minor compatibility alias.
- Valid cycles persist `report.md`, `report.json`, `actions.md`, and all role
  board files.
- Qualified actions create proposed Quick Task, Spec, Epic, decision, or agent
  artifacts with causality sidecars.
- Unapproved drafts fail PLAN/SHIP entry with
  `E_OPERATE_DRAFT_UNAPPROVED` and an exact approval command.
- Existing Protocol v1.2/v1.3 projects remain readable.

## Release transaction

Release order is `planr-pipeline@0.37.0` → draft marketplace ledger →
`openplanr@1.21.0` → `@openplanr/skills@1.23.0` → marketplace `1.8.0`.
Every repository retains its own branch, CI, PR, tag, package, and rollback
boundary. The marketplace ledger remains unmerged until clean-machine and real
runtime canaries pass.
