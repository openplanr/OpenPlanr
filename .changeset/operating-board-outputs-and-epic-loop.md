---
"openplanr": minor
---

Operating Board outputs and epic-loop release for `planr operate` (SPEC-003), the
`openplanr` minor bump 1.18.0 → 1.19.0. Every claim below is backed by a named proof;
nothing describes a phase this repository has not actually reached.

Cycle reports and boards are now persisted as truthful on-disk artifacts: a single rich
assembly drives both `cycles/<id>/report.md` and every `board/<role>.md`, so `report.md`
is byte-identical to the review rendering and each evaluated board file carries its lens
recommendations with impact/confidence/ease (I/C/E) scores — proven by
`tests/unit/operate-projection-persistence.test.ts` ("renders cycles/<id>/report.md and
rich board files from the assembled lens artifacts"). The readable tree is consolidated:
the legacy `projections/` directory is retired (never written), the parked-findings
`backlog.md` is promoted to the top level, and `state.json` moves under `.state/` —
proven by `tests/integration/operate-preview-boundaries.test.ts` and the persistence
suite's asserted paths (`.planr/operate/backlog.md`, `.planr/operate/.state/state.json`,
no `projections/`).

Evidence loss is never silent. A capped repository walk names the last path it reached
and the top-level directories it never scanned, mission-index drops are counted and
surfaced as cycle warnings, sensitivity narrowing is scoped to the offending items, and a
starved role is gated not-ready with a governed data gap while every ready role still
dispatches — proven by `tests/integration/operate-evidence-recovery.test.ts` ("gates a
starved repository role with a governed gap while other roles still dispatch (FR2)").
Collection is prioritized and fair: per-top-level-directory round-robin plus git-recency
ordering, with split repository/planr file budgets replacing the shared `maxFiles`
counter — proven by `tests/integration/operate-evidence-monorepo-fairness.test.ts`
("samples every product top-level directory under a cap the tree exceeds combined" and its
deterministic re-selection check).

Mission budgets are sized for real repositories: the derived mission-budget clamp ceiling
rises from 9 to 32 KiB against real index-item costs, per-role `maxEvidenceItems` caps are
enforced, and an oversized index is truncated to fit with the drop reported as a cycle
warning — never a silent drop and never an unexplained fail-closed on a healthy repo —
proven by `tests/unit/operate-mission-packet.test.ts` ("truncates a monorepo-scale index
to the cap, fits the budget, and reports the drop (FR4)" and "leaves a healthy repository
under its cap untouched — no warning, no fail-closed (FR4)"), with the field-scale pack
path still failing closed with no provider invocation in
`tests/unit/operate-advisor-pack-scale.test.ts`.

Re-initialization preserves machine-local preferences: a no-flag re-init carries
`dispatchModeOverrides`, `adapterLeaseDurationMs`, and `lastRunAt` forward, and the init
preview names exactly which preference a re-init will change — proven by
`tests/unit/operate-initialization-replay.test.ts` ("carries dispatchModeOverrides,
adapterLeaseDurationMs, and lastRunAt forward on a re-init with no flags (field repro)")
and `tests/integration/operate-guided-init.test.ts` ("names exactly which machine-local
preferences a re-init will change in the preview").

The epic loop closes: the report groups related accepted findings into a ready-to-run
`planr epic create --title …` suggestion naming the member findings, and the `create-epic`
route applies a real `.planr/epics/EPIC-NNN-<slug>.md` artifact through the write-ahead
journal with byte-exact rollback while never invoking PLAN or SHIP (R1 intact) — proven by
`tests/integration/operate-decision-brief-render.test.ts` ("renders one planr epic create
suggestion naming both accepted findings") and `tests/integration/operate-route-lanes.test.ts`
("elects, applies, and byte-exact rolls back a grouped-finding epic without ever invoking
PLAN or SHIP").

Pins the optional `planr-pipeline` runtime to the exact `0.35.0` — the build that ships the
FR4 packet-enforcement half, the additive FR8 `create-epic` operating-route-plan schema,
the reviewed registry role budgets, and the regenerated operate assets this release proves
against (`optionalDependencies["planr-pipeline"] === "0.35.0"`, mirrored by the three
workflow `ref: v0.35.0` pins and both packed-install e2e assertions).
