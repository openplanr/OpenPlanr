---
id: "BL-013"
title: "spec mode: align with generic verbs (ArtifactType, planr update, status validation, prefix routing)"
priority: "high"
tags: ["spec-driven", "alignment", "consistency", "follow-up"]
status: "open"
created: "2026-04-25"
updated: "2026-04-25"
---

# BL-013: spec mode — alignment audit with generic verbs

## Priority
HIGH

## Tags

- spec-driven
- alignment
- consistency
- follow-up

## Description

Spec-driven mode landed with its own command surface (`planr spec init/create/shape/decompose/status/sync/promote`), its own service (`spec-service.ts`), and its own directory shape (`.planr/specs/SPEC-NNN-slug/`). What didn't land is integration with the rest of OpenPlanr's generic prefix-routing verbs.

Surfaced during dogfooding when the IDE flagged 6 test fixtures missing `idPrefix.spec`. Fixing the fixtures is trivial (one-line per file), but the IDE noise was a symptom of a deeper alignment gap: `ArtifactType` and the prefix-routing helpers don't know about specs at all.

## Concrete gaps

| Gap | File | Symptom |
|---|---|---|
| `ArtifactType` union excludes `'spec'` | [src/models/types.ts:1-10](src/models/types.ts:1) | TS narrowing forces every consumer to handle `'epic' \| 'feature' \| ... \| 'checklist'` only |
| `findArtifactTypeById` no `SPEC:` mapping | [src/services/artifact-service.ts:336](src/services/artifact-service.ts:336) | Returns `null` for `SPEC-001` |
| `planr update SPEC-001` fails | [src/cli/commands/update.ts:35](src/cli/commands/update.ts:35) | "Unknown artifact type for ID" |
| `VALID_STATUSES` may have no `spec` key | [src/utils/constants.ts](src/utils/constants.ts) | Status validation crash if spec ever uses generic update |
| `planr revise SPEC-001` likely fails | revise pipeline | Same prefix-routing assumption |
| `planr linear push SPEC-...` not designed | [src/cli/commands/linear.ts](src/cli/commands/linear.ts) | Help text lists EPIC/FEAT/US/TASK only — may be intentional |

## What "good" looks like

A clear, documented stance: which generic verbs apply to specs and which don't.

- **Verbs that should work on specs**: `planr status`, `planr update <SPEC-id>` (for status / metadata), maybe `planr revise <SPEC-id>` (the spec.md is single-file). Adding these requires extending `ArtifactType`, `findArtifactTypeById`, `VALID_STATUSES`, and the per-verb routing.
- **Verbs that don't apply**: `planr linear push SPEC-001` (specs decompose into pipeline tasks, not Linear issues). Document as a deliberate non-goal in the help text and on the spec spec.
- **Verbs that need new sub-commands**: spec aggregation views (`planr spec list`, `planr spec show <id>`) already exist in `planr spec`. The generic verb surface should defer to those for spec-shaped operations.

## Acceptance criteria

1. `ArtifactType` includes `'spec'` (or has a documented carve-out explaining why specs are intentionally excluded).
2. `findArtifactTypeById('SPEC-001')` returns `'spec'`.
3. `planr update SPEC-001 --status done` either works (writes to `.planr/specs/SPEC-001-slug/SPEC-001-slug.md` frontmatter) or errors with a friendly "use `planr spec update` instead" pointer.
4. `VALID_STATUSES.spec` is defined with the spec lifecycle values (`pending` / `decomposed` / `in-pipeline` / `done`).
5. `planr revise SPEC-001` either works or errors with a clear message explaining specs aren't revise-eligible (and why).
6. `planr linear push` help text and error path explicitly note specs are out of scope (not just by omission).
7. Test fixture audit — every config builder in `tests/` declares all `idPrefix` keys explicitly so adding a new artifact type doesn't silently break them.
8. Migration test: a `.planr/config.json` from a pre-spec project loads without error (Zod default fills in `spec: 'SPEC'`). Already works via the schema default — add a regression test if missing.

## Out of scope

- **`planr github push` for specs** — separate workstream, file as own BL if needed.
- **Spec → agile downconversion** — explicit non-goal in BL-011.
- **Bulk spec promotion to pipeline** — covered by `planr spec promote --to-pipeline` already.

## Size estimate

~3–5 hours total, split into two slices:

- **Slice 1 (~1 hour)** — extend `ArtifactType` + `findArtifactTypeById` + `VALID_STATUSES` to include spec. Most generic verbs auto-light-up because they iterate the union.
- **Slice 2 (~2–4 hours)** — per-verb decisions: which work, which error with a pointer, which silently skip. Touches `planr update`, `planr revise`, `planr linear push`, `planr github push`. Each gets either a wired path or a clear "not supported for specs" error message + docs note.

Ship slice 1 first (low risk, high coverage). Slice 2 can be a sequence of small PRs.

## Notes

This BL was filed when fixing test fixtures revealed how many places assume the pre-spec `ArtifactType` shape. Treat the fixture audit (commit `a0135ae`) as the trigger and this BL as the follow-up cleanup.

---
_Promote to agile hierarchy: `planr backlog promote BL-013 --story` or `planr backlog promote BL-013 --quick`_
_Close when done: `planr backlog close BL-013`_
