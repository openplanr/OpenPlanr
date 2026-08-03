---
id: "EPIC-003"
title: "Plan Revision Layer (`planr revise`)"
owner: "Engineering"
created: "2026-04-21"
updated: "2026-04-21"
status: "done"
project: "OpenPlanr"
---

# EPIC-003: Plan Revision Layer (`planr revise`)

**Design brief (full architecture, phases, open questions):** [.planr/EPIC-REVISE-COMMAND.md](../EPIC-REVISE-COMMAND.md)

## Business Value

Keeps `.planr/` artifacts **aligned with the real repo** — codebase, declared sources of truth, and sibling plans — by **actively rewriting them**, not just reporting drift. Replaces the "careful human re-read and edit" cycle with one command that produces diff previews, human-confirmed writes, and an audit log, so teams spend implementation time on correct plans instead of reconciling them.

## Target Users

Developers and tech leads maintaining `.planr/` hierarchies; CI owners who want an explicit plan-alignment step (with confirmation) before merging feature work; anyone already using `planr refine` who needs a companion that goes beyond prose polish to fix structural drift.

## Problem Statement

Plans in `.planr/` diverge from reality as soon as code, ADRs, or conventions move. Today the fix is manual: re-read each artifact, grep the codebase, edit by hand. There is no first-class command that gathers **artifact chain + siblings + codebase + declared sources**, asks an AI what has drifted, **verifies the AI's evidence**, shows a diff, and **writes the alignment back into the artifacts**.

## Solution Overview

Introduce `**planr revise`** as an **agentic revision command** in the same family as `planr refine`, but actively modifying artifact files (not just improving prose of one in isolation):

- **Context pack:** target artifact + parent chain + immediate siblings + codebase context (existing `context-builder.ts`) + optional declared sources from `.planr/revise.yaml`.
- **Prompt + schema:** `REVISE_SYSTEM_PROMPT` with decision rubric (`revise` / `skip` / `flag`), evidence-type taxonomy, facts-vs-intent rule; `aiReviseDecisionSchema` (zod) for typed per-artifact decisions.
- **Four-layer safety:** evidence gate (drops unverifiable changes) → diff preview → human confirmation → post-flight graph-integrity check + git rollback on failure.
- **Cascade:** top-down (epic → features → stories → tasks) so children see the *revised* parent, not the stale one.
- **Output:** modified artifact files on disk + audit log (Markdown or JSON) in `.planr/reports/`.

Project-agnosticism comes from the **agent reading the actual repo**, not from shipping per-framework plugins.

## Success Criteria

- `planr revise EPIC-003 --dry-run` on this repo produces an audit log where at least one `would-apply` and one `flagged` entry are correct on first human read.
- Evidence verifier drops any change whose cited evidence doesn't verify (test with planted hallucination).
- `planr revise EPIC-003` refuses to run with a dirty git tree unless `--allow-dirty` is passed.
- `planr revise --all --dry-run` produces a per-artifact audit log in top-down cascade order and touches no files.
- A synthetic graph-break during write triggers auto-rollback and restores repo state exactly; audit log records the rollback.

## Key Features (shipping trajectory)


| Phase   | Focus                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Types, zod schema, `REVISE_SYSTEM_PROMPT`, `buildRevisePrompt`, `revise-service.reviseArtifact` (dry-run only), CLI registration, stubbed tests |
| 2       | Evidence verifier, clean-tree gate, atomic write with backup, diff preview, interactive confirmation, `--yes` mode                              |
| 3       | Cascade (top-down), sibling context, audit log grouping, mid-cascade interrupt safety                                                           |
| 4       | `--all` with `max_writes_per_run`, post-flight graph integrity, automatic git rollback on break                                                 |
| 5       | `--no-code-context`, token budget guards, run cache, README + docs                                                                              |
| 6+ (v2) | `writable.subtask_checkboxes`, `writable.frontmatter_status`, Gherkin revision, artifact moves, baseline/ratchet (see brief)                    |


## Dependencies

Existing **AI stack** (`ai-service`, `generateJSON`, zod schemas), `**context-builder.ts`**, `**prompt-builder.ts**`, `**artifact-service.ts**`, `**prompt-service.ts**` (interactive prompts), `**syncParentChildLinks**` (graph-integrity reuse), git CLI for clean-tree and rollback. **Requires configured AI provider** — unlike refine, revise has no deterministic-only fallback worth shipping.

## Risks

Agent rewriting correct content into wrong content (mitigated by evidence gate + diff preview + clean-tree rollback); bulk mode amplifying one bad decision (mitigated by top-down cascade + `max_writes_per_run` + typed-YES gate); facts-vs-intent conflicts where plan was right and code was wrong (mitigated by never rewriting intent, only flagging ambiguity); agent hallucinating paths (typed evidence taxonomy + verifier); token cost on `--all` (Phase 5 cache + fast mode). Prompt quality is the primary product risk — see brief for the nine-item `REVISE_SYSTEM_PROMPT` checklist.

## Features

- [FEAT-010: Core Revise Engine with Decision Schema](../features/FEAT-010-core-revise-engine-with-decision-schema.md)
- [FEAT-011: Safety Gates and Atomic Write System](../features/FEAT-011-safety-gates-and-atomic-write-system.md)
- [FEAT-012: Cascade Processing and Sibling Context](../features/FEAT-012-cascade-processing-and-sibling-context.md)
- [FEAT-013: Bulk Operations and Graph Integrity](../features/FEAT-013-bulk-operations-and-graph-integrity.md)
- [FEAT-014: Performance and Usability Enhancements](../features/FEAT-014-performance-and-usability-enhancements.md)

## Alignment

Sources of truth this epic is aligned against. `planr revise` itself should one day cite these when auditing its own epic — the list is here so revise can check alignment stays honest as the codebase evolves.

- **Design brief:** [.planr/EPIC-REVISE-COMMAND.md](../EPIC-REVISE-COMMAND.md) — authoritative architecture; when this file and the brief disagree on technical detail, the brief wins.
- **Architectural precedent:** [src/cli/commands/refine.ts](../../src/cli/commands/refine.ts), [src/ai/prompts/prompt-builder.ts](../../src/ai/prompts/prompt-builder.ts), [src/ai/prompts/system-prompts.ts](../../src/ai/prompts/system-prompts.ts) — revise is shaped after refine's agentic pattern.
- **Reused infrastructure:** [src/ai/codebase/context-builder.ts](../../src/ai/codebase/context-builder.ts), [src/services/ai-service.ts](../../src/services/ai-service.ts), [src/services/artifact-service.ts](../../src/services/artifact-service.ts), [src/services/prompt-service.ts](../../src/services/prompt-service.ts), [src/cli/commands/sync.ts](../../src/cli/commands/sync.ts) (`syncParentChildLinks` for graph integrity).
- **Related backlog:** [.planr/backlog/BL-001-feedback-driven-refine-add-feedback-and-file-flags-to.md](../backlog/BL-001-feedback-driven-refine-add-feedback-and-file-flags-to.md) — adjacent but distinct (refine `--feedback` is a directed push; revise is an open-ended pull).

## Related

- [.planr/EPIC-REVISE-COMMAND.md](../EPIC-REVISE-COMMAND.md) — authoritative architecture, sample audit log, open questions, risks table, prompt-engineering checklist, explicit relationship-to-refine section

