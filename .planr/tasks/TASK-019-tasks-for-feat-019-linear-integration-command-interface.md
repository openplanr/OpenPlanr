---
id: "TASK-019"
title: "Tasks for FEAT-019: Linear Integration Command Interface"

featureId: "FEAT-019"
created: "2026-04-21"
updated: "2026-04-19"
status: "done"
---

# TASK-019: Tasks for FEAT-019: Linear Integration Command Interface


**Feature:** [FEAT-019](../features/FEAT-019-linear-integration-command-interface.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-070`
- **User Story:** `.planr/stories/US-071`
- **User Story:** `.planr/stories/US-072`
- **User Story:** `.planr/stories/US-073`
- **User Story:** `.planr/stories/US-074`
- **User Story:** `.planr/stories/US-075`
- **Gherkin:** `.planr/stories/US-070-gherkin.feature`
- **Gherkin:** `.planr/stories/US-071-gherkin.feature`
- **Gherkin:** `.planr/stories/US-072-gherkin.feature`
- **Gherkin:** `.planr/stories/US-073-gherkin.feature`
- **Gherkin:** `.planr/stories/US-074-gherkin.feature`
- **Gherkin:** `.planr/stories/US-075-gherkin.feature`

## Tasks

- [x] **1.0** Implement Linear sync command foundation
  - [x] 1.1 Create linear command group in src/cli/commands/linear.ts with sync subcommand
  - [x] 1.2 Add --dry-run and --update-only flags to sync command with proper argument parsing
  - [x] 1.3 Register linear command in src/cli/index.ts following existing pattern
  - [x] 1.4 Add LinearSyncOptions interface to src/models/types.ts
- [x] **2.0** Implement dry-run functionality
  - [x] 2.1 Create dry-run analysis logic that shows planned changes without API calls
  - [x] 2.2 Display detailed plan output for create/update operations on all artifact types
  - [x] 2.3 Handle no-changes scenario with appropriate user messaging
  - [x] 2.4 Show bidirectional changes for both push and pull operations
- [x] **3.0** Implement update-only sync mode
  - [x] 3.1 Add logic to skip creation of new Linear items when --update-only flag is set
  - [x] 3.2 Ensure bidirectional checkbox and status sync works for existing items only
  - [x] 3.3 Combine --update-only with --dry-run to show planned updates without new items
- [x] **4.0** Add progress feedback system
  - [x] 4.1 Implement progress indicators showing current operation and completion percentage
  - [x] 4.2 Display specific details about items being created or updated during sync
  - [x] 4.3 Handle errors gracefully with context about what was being processed
- [x] **5.0** Create comprehensive help documentation
  - [x] 5.1 Add detailed help text for linear command group showing all subcommands
  - [x] 5.2 Create comprehensive sync command help with flag descriptions and examples
  - [x] 5.3 Include practical usage examples for common scenarios and flag combinations
- [x] **6.0** Implement error handling with actionable guidance
  - [x] 6.1 Add authentication error handling with guidance to run 'planr linear init'
  - [x] 6.2 Handle network errors with retry suggestions and Linear status page reference
  - [x] 6.3 Implement rate limit error handling with estimated wait time display
- [x] **7.0** Implement `planr linear status` — local-only mapping-table viewer (US-075)
  - [x] 7.1 Walk `.planr/epics/`, `.planr/features/`, `.planr/stories/`, `.planr/tasks/` and collect every artifact's `linear*Id` + `linear*Url` frontmatter fields via the existing `listArtifacts` / `readArtifact` helpers in `artifact-service.ts`
  - [x] 7.2 Render a 4-column table (OpenPlanr id · Linear identifier · Linear URL · last-known state) with missing-ID rows shown as "(not pushed)"
  - [x] 7.3 Support `--scope <EPIC-ID>` to limit the table to one epic's subtree (reuses the cascade-order helper from FEAT-016)
  - [x] 7.4 Flag malformed `linearIssueId` values with a "stale-id" marker and suggestion to re-run `planr linear push`
  - [x] 7.5 Zero Linear API calls — the command reads only local frontmatter

## Acceptance Criteria Mapping

- [x] I see a detailed plan of what would be created/updated without any API calls being made (US-070) → Tasks 2.1, 2.2
- [x] I see a message indicating no changes are needed (US-070) → Tasks 2.3
- [x] I see planned changes for both push and pull operations (US-070) → Tasks 2.4
- [x] Only existing Linear items are updated and no new items are created (US-071) → Tasks 3.1
- [x] Checkbox states are synced bidirectionally for existing items only (US-071) → Tasks 3.2
- [x] I see planned updates for existing items only (US-071) → Tasks 3.3
- [x] I see progress indicators showing current operation and completion percentage (US-072) → Tasks 4.1
- [x] I see specific details about what is being created or updated (US-072) → Tasks 4.2
- [x] I see the error with context about what was being processed (US-072) → Tasks 4.3
- [x] I see all available Linear subcommands with brief descriptions (US-073) → Tasks 5.1
- [x] I see detailed help for sync command including --dry-run and --update-only flags with examples (US-073) → Tasks 5.2
- [x] I see real examples showing common use cases and flag combinations (US-073) → Tasks 5.3
- [x] I see an error message explaining the auth issue and how to fix it with 'planr linear init' (US-074) → Tasks 6.1
- [x] I see an error message suggesting to retry and check Linear status page (US-074) → Tasks 6.2
- [x] I see an error message with estimated wait time before retrying (US-074) → Tasks 6.3
- [x] The table lists every artifact with `linear*Id` in frontmatter alongside its Linear identifier and URL (US-075) → Tasks 7.1, 7.2
- [x] Artifacts without `linear*Id` are shown as "(not pushed)" (US-075) → Tasks 7.2
- [x] Malformed Linear IDs are flagged as "stale-id" with a re-push suggestion (US-075) → Tasks 7.4
- [x] `--scope EPIC-001` limits the table to EPIC-001 and its descendants (US-075) → Tasks 7.3
- [x] The command makes zero Linear API calls (US-075) → Tasks 7.5

## Relevant Files

- `src/cli/commands/linear.ts` — New command file for Linear integration commands including sync with flags
- `src/cli/index.ts` — Register the new linear command following existing pattern
- `src/models/types.ts` — Add LinearSyncOptions interface and related types

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
