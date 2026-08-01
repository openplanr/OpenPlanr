# OPERATE-SPEC-006 CLI work item

Umbrella specification: `SPEC-003`  
Release participant: `openplanr@1.19.0`

This repository's contribution to the coordinated `OPERATE-SPEC-006` release of the
Operating Board: truthful cycle outputs and readable-tree consolidation (a single rich
assembly drives both `cycles/<id>/report.md` — byte-identical to the review rendering —
and every `board/<role>.md` with impact/confidence/ease recommendations; the legacy
`projections/` directory retired, `backlog.md` promoted to the top level, and `state.json`
relocated under `.state/`), never-silent evidence loss (capped repository walks name the
last path reached and the top-level directories left unscanned, mission-index drops are
counted as cycle warnings, sensitivity narrowing is scoped to the offending items, and a
starved role is gated not-ready with a governed data gap while ready roles still dispatch)
over a prioritized, fair collection pass (per-directory round-robin plus git-recency
ordering with split repository/planr budgets), mission budgets sized for real repositories
(the derived clamp ceiling raised from 9 to 32 KiB, per-role evidence caps enforced, and
truncation surfaced rather than silently dropped or fail-closed on a healthy repo), re-init
preservation of machine-local preferences (`dispatchModeOverrides`,
`adapterLeaseDurationMs`, and `lastRunAt` carried forward, with the preview naming any
preference that will change), and the epic loop (grouped accepted findings emit a
ready-to-run `planr epic create` suggestion, and the `create-epic` route applies a real
`.planr/epics/EPIC-NNN-<slug>.md` artifact through the write-ahead journal with byte-exact
rollback, never invoking PLAN or SHIP — R1 holds).

Full feature specification: `.planr/specs/SPEC-003-operating-board-outputs-and-epic-loop/`.
Depends on `planr-pipeline@0.35.0` (the FR4 packet-enforcement half, the additive FR8
`create-epic` operating-route-plan schema, the reviewed registry role budgets, and the
regenerated operate assets this release proves against).

Before publication each participant may compensate locally; after an npm package is public,
recovery is forward-fix only.
