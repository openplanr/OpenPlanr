---
id: "FEAT-010"
title: "Core Revise Engine with Decision Schema"
epicId: "EPIC-003"
owner: "Engineering"
created: "2026-04-21"
updated: "2026-04-21"
status: "done"
---

# FEAT-010: Core Revise Engine with Decision Schema

**Epic:** [EPIC-003](../epics/EPIC-003-plan-revision-layer-revise-command.md)

## Overview
Implements the foundational revise service with AI decision-making schema, system prompt, and single-artifact processing. Establishes the core types and prompt building infrastructure for revision decisions. **Phase 1 is dry-run only — no file writes.** The write path lands in FEAT-011.

## Functional Requirements

- Define core types in `src/models/types.ts`: `ReviseDecision`, `ReviseEvidence`, `ReviseEvidenceType`, `ReviseAmbiguity`, `ReviseAudit`
- Define `aiReviseDecisionSchema` (zod) in `src/ai/schemas/ai-response-schemas.ts` with `action ∈ {revise, skip, flag}` and typed evidence taxonomy (`file_exists`, `file_absent`, `grep_match`, `sibling_artifact`, `source_quote`, `pattern_rule`)
- Implement `REVISE_SYSTEM_PROMPT` in `src/ai/prompts/system-prompts.ts` with facts-vs-intent rule, decision rubric, evidence-type taxonomy, hallucination guardrails, few-shot pair (see brief §Prompt-engineering deliverable)
- Create `buildRevisePrompt(artifact, parents, siblings, codebaseContext, sources, scopeTo)` in `src/ai/prompts/prompt-builder.ts`
- Build `revise-service.reviseArtifact(id, { dryRun: true })` that returns a `ReviseDecision` and **never writes to disk in this phase**
- Register `planr revise` CLI command in `src/cli/commands/revise.ts` + `src/cli/index.ts` with argument parsing for the full v1 flag surface (even if only `--dry-run` is honored in Phase 1)
- Ship tests against fixture artifacts under `tests/fixtures/revise/` with a stubbed AI provider (matches the pattern used in refine tests)

## User Stories

- [US-032: Define AI revision decision schema with evidence taxonomy](../stories/US-032-define-ai-revision-decision-schema-with-evidence-taxonomy.md)
- [US-033: Implement REVISE_SYSTEM_PROMPT with decision rubric](../stories/US-033-implement-revise-system-prompt-with-decision-rubric.md)
- [US-034: Create buildRevisePrompt function for artifact context packaging](../stories/US-034-create-buildreviseprompt-function-for-artifact-context-packaging.md)
- [US-035: Build revise service for single-artifact dry-run processing](../stories/US-035-build-revise-service-for-single-artifact-dry-run-processing.md)
- [US-036: Register planr revise CLI command with argument parsing](../stories/US-036-register-planr-revise-cli-command-with-argument-parsing.md)

## Dependencies
Existing AI stack (ai-service, generateJSON), context-builder.ts, prompt-builder.ts

## Technical Considerations
Zod schema must enforce evidence type taxonomy to enable verification layer. System prompt needs careful tuning for facts vs intent distinction.

## Risks
Poor prompt quality could lead to incorrect revision decisions. Schema design affects all downstream safety layers.

## Success Metrics
planr revise EPIC-002 --dry-run produces correctly categorized decisions with verifiable evidence citations
