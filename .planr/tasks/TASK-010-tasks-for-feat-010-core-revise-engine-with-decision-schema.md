---
id: "TASK-010"
title: "Tasks for FEAT-010: Core Revise Engine with Decision Schema"

featureId: "FEAT-010"
created: "2026-04-21"
updated: "2026-04-21"
status: "done"
---

# TASK-010: Tasks for FEAT-010: Core Revise Engine with Decision Schema


**Feature:** [FEAT-010](../features/FEAT-010-core-revise-engine-with-decision-schema.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-032`
- **User Story:** `.planr/stories/US-033`
- **User Story:** `.planr/stories/US-034`
- **User Story:** `.planr/stories/US-035`
- **User Story:** `.planr/stories/US-036`
- **Gherkin:** `.planr/stories/US-032-gherkin.feature`
- **Gherkin:** `.planr/stories/US-033-gherkin.feature`
- **Gherkin:** `.planr/stories/US-034-gherkin.feature`
- **Gherkin:** `.planr/stories/US-035-gherkin.feature`
- **Gherkin:** `.planr/stories/US-036-gherkin.feature`

## Tasks

- [x] **1.0** Define AI revision decision schema and types
  - [x] 1.1 Add revision decision types to src/models/types.ts (ReviseAction, ReviseEvidenceType, ReviseEvidence, ReviseAmbiguity, ReviseDecision — unions match codebase convention over TS enums; `Revise*` prefix matches brief + FEAT-010)
  - [x] 1.2 Create aiReviseDecisionSchema in src/ai/schemas/ai-response-schemas.ts with evidence taxonomy validation + action-specific invariants via superRefine (revise→revisedMarkdown+evidence; flag→ambiguous; skip→neither)
  - [x] 1.3 Add unit tests for schema validation with valid/invalid decision examples (12 tests added to tests/unit/ai-schemas.test.ts covering all 3 US-032 gherkin scenarios + invariant matrix for revise/skip/flag + evidence taxonomy)
- [x] **2.0** Implement REVISE_SYSTEM_PROMPT with decision rubric
  - [x] 2.1 Add REVISE_SYSTEM_PROMPT constant to src/ai/prompts/system-prompts.ts with facts-vs-intent rules
  - [x] 2.2 Include decision rubric for revise/skip/flag choices and evidence requirements in prompt
  - [x] 2.3 Add JSDoc documentation explaining prompt structure and usage
- [x] **3.0** Create buildRevisePrompt function for context packaging
  - [x] 3.1 Add buildRevisePrompt function to src/ai/prompts/prompt-builder.ts that combines artifact + context
  - [x] 3.2 Integrate with existing buildContext from src/ai/codebase/context-builder.ts for codebase context (builder consumes pre-rendered string via `codebaseContextFormatted`; caller handles the async formatCodebaseContext call)
  - [x] 3.3 Add parent chain resolution using readArtifact from artifact-service (implemented in revise-service §4.1 to keep builder sync; see revise-service `resolveParentChain`)
  - [x] 3.4 Add unit tests for prompt building with various context scenarios (9 tests covering target, parents, siblings, codebase, sources, scope, none-markers, section ordering)
- [x] **4.0** Build revise service for single-artifact processing
  - [x] 4.1 Create src/services/revise-service.ts with reviseArtifact function for dry-run processing (plus `loadParentPromptArtifacts` helper and `ReviseArtifactNotFoundError`)
  - [x] 4.2 Integrate generateJSON from ai-service with aiReviseDecisionSchema validation
  - [x] 4.3 Add error handling for AI service failures and schema validation errors (throws surfaces from generateJSON; ReviseArtifactNotFoundError for id/file lookup)
  - [x] 4.4 Add unit tests for successful revision decisions and error scenarios (6 tests — valid revise, skip, unknown prefix, missing file, prompt frontmatter inclusion, schema error propagation)
- [x] **5.0** Register planr revise CLI command
  - [x] 5.1 Create src/cli/commands/revise.ts (followed refine.ts pattern — closer match than quick.ts for AI-driven artifact-id commands)
  - [x] 5.2 Add argument parsing for artifact ID, --dry-run, --scope-to, --no-code-context with validation
  - [x] 5.3 Integrate with reviseArtifact service and render structured decision output (action, rationale, evidence, ambiguous, revisedMarkdown preview, context stats, token usage)
  - [x] 5.4 Register revise command in src/cli/index.ts following existing registerCommand pattern (alphabetically between refine and report)
  - [x] 5.5 Add error handling for invalid artifact IDs (ReviseArtifactNotFoundError), missing AI configuration (early exit with explicit message), and AIError surfacing

## Acceptance Criteria Mapping

- [ ] An AI decision with type 'revise' and code_reference evidence passes validation against aiReviseDecisionSchema (US-032) → Tasks 1.2, 1.3
- [ ] An AI decision with type 'revise' but no evidence citations fails validation with clear error about missing evidence (US-032) → Tasks 1.2, 1.3
- [ ] An AI decision with type 'flag' and ambiguity evidence passes validation as a flagged item (US-032) → Tasks 1.2, 1.3
- [ ] The REVISE_SYSTEM_PROMPT constant contains clear rules for revise/skip/flag decisions (US-033) → Tasks 2.1, 2.2
- [ ] The prompt instructs to revise facts but flag intent conflicts (US-033) → Tasks 2.1, 2.2
- [ ] The prompt requires specific evidence citations for all decisions (US-033) → Tasks 2.1, 2.2
- [ ] buildRevisePrompt with an artifact returns a structured prompt with artifact content and context (US-034) → Tasks 3.1, 3.2
- [ ] buildRevisePrompt with an artifact with parent relationships includes parent artifact content for context (US-034) → Tasks 3.3
- [ ] buildRevisePrompt with an artifact with minimal context returns a valid prompt with available information only (US-034) → Tasks 3.1, 3.4
- [ ] reviseArtifact in dry-run mode returns a structured revision decision without modifying files (US-035) → Tasks 4.1, 4.2
- [ ] reviseArtifact when AI service is unavailable returns an error decision with clear failure reason (US-035) → Tasks 4.3
- [ ] reviseArtifact returns a decision that conforms to aiReviseDecisionSchema (US-035) → Tasks 4.2, 4.4
- [ ] 'planr revise EPIC-002 --dry-run' processes the artifact and shows revision decisions without writing files (US-036) → Tasks 5.1, 5.2, 5.3
- [ ] 'planr revise INVALID-ID --dry-run' shows a clear error message about the missing artifact (US-036) → Tasks 5.2, 5.5
- [ ] 'planr revise --help' displays usage information and available options (US-036) → Tasks 5.1, 5.2

## Relevant Files

- `src/models/types.ts` — Add revision decision types and evidence taxonomy interfaces
- `src/ai/schemas/ai-response-schemas.ts` — Add aiReviseDecisionSchema for validating AI revision decisions
- `src/ai/prompts/system-prompts.ts` — Add REVISE_SYSTEM_PROMPT constant with decision rubric
- `src/ai/prompts/prompt-builder.ts` — Add buildRevisePrompt function for packaging artifact context
- `src/services/revise-service.ts` — Create new service for single-artifact revision processing
- `src/cli/commands/revise.ts` — Create new CLI command for revision functionality
- `src/cli/index.ts` — Register the new revise command following existing pattern

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
