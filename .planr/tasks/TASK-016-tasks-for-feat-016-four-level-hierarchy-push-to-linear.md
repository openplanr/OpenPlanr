---
id: "TASK-016"
title: "Tasks for FEAT-016: Four-Level Hierarchy Push to Linear"

featureId: "FEAT-016"
created: "2026-04-21"
updated: "2026-04-19"
status: "done"
---

# TASK-016: Tasks for FEAT-016: Four-Level Hierarchy Push to Linear


**Feature:** [FEAT-016](../features/FEAT-016-four-level-hierarchy-push-to-linear.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-057`
- **User Story:** `.planr/stories/US-058`
- **User Story:** `.planr/stories/US-059`
- **User Story:** `.planr/stories/US-060`
- **User Story:** `.planr/stories/US-061`
- **Gherkin:** `.planr/stories/US-057-gherkin.feature`
- **Gherkin:** `.planr/stories/US-058-gherkin.feature`
- **Gherkin:** `.planr/stories/US-059-gherkin.feature`
- **Gherkin:** `.planr/stories/US-060-gherkin.feature`
- **Gherkin:** `.planr/stories/US-061-gherkin.feature`

## Tasks

- [x] **1.0** Add Linear SDK integration and types
  - [x] 1.1 Install @linear/sdk dependency and add Linear-specific types to src/models/types.ts
  - [x] 1.2 Add LinearConfig interface to OpenPlanrConfig (`teamId`, `teamKey`, `defaultProjectLead`, `statusMap`) — matches `.planr/EPIC-LINEAR-INTEGRATION.md` config block
  - [x] 1.3 Extend ArtifactFrontmatter to include the full Linear field set per artifact type (all optional):
    - **Epic:** `linearProjectId`, `linearProjectIdentifier`, `linearProjectUrl`
    - **Feature:** `linearIssueId`, `linearIssueIdentifier`, `linearIssueUrl`
    - **Story:** `linearIssueId`, `linearIssueIdentifier`, `linearIssueUrl`, `linearParentIssueId`
    - **TaskList:** `linearIssueId`, `linearIssueIdentifier`, `linearIssueUrl`, `linearParentIssueId`, `linearTaskChecklistSyncedAt`
    These are additive alongside the existing `githubIssue` field so both integrations can coexist.
- [x] **2.0** Create Linear service for API operations
  - [x] 2.1 Create src/services/linear-service.ts with LinearClient wrapper and authentication
  - [x] 2.2 Implement createProject, createIssue, createSubIssue functions using @linear/sdk mutations
  - [x] 2.3 Add updateProject, updateIssue functions for idempotent operations
  - [x] 2.4 Implement proper parent-child linking via Linear's hierarchy system
- [x] **3.0** Implement Linear push command
  - [x] 3.1 Create src/cli/commands/linear.ts following the pattern in src/cli/commands/quick.ts
  - [x] 3.2 Implement 'planr linear push <epic-id>' command with Epic to Project mapping
  - [x] 3.3 Add --dry-run flag support showing complete hierarchy preview without API calls
  - [x] 3.4 Register linear command in src/cli/index.ts following existing pattern
- [x] **4.0** Implement Epic to Linear Project mapping
  - [x] 4.1 Create Epic to Project conversion logic using readArtifact from src/services/artifact-service.ts
  - [x] 4.2 Map Epic frontmatter fields to Linear Project metadata (title, description)
  - [x] 4.3 Store Linear project ID in Epic frontmatter using updateArtifactFields
  - [x] 4.4 Handle existing Linear project ID for idempotent updates
- [x] **5.0** Implement Feature to Linear Issue mapping
  - [x] 5.1 Create Feature to top-level Issue conversion using listArtifacts and readArtifact
  - [x] 5.2 Link Feature issues to parent Epic project using Linear's project association
  - [x] 5.3 Store Linear issue IDs in Feature frontmatter using updateArtifactFields
- [x] **6.0** Implement Story to Linear sub-issue mapping
  - [x] 6.1 Create Story to sub-issue conversion maintaining Feature parent relationship
  - [x] 6.2 Link Story sub-issues to parent Feature issues using Linear's hierarchy system
  - [x] 6.3 Store Linear issue IDs in Story frontmatter using updateArtifactFields
- [x] **7.0** Implement TaskList to Linear sub-issue with checkboxes
  - [x] 7.1 Create TaskList to dedicated sub-issue conversion with markdown checkbox formatting
  - [x] 7.2 Generate one TaskList sub-issue per Feature containing all tasks as checkboxes
  - [x] 7.3 Preserve task completion state in markdown checkbox format
  - [x] 7.4 Store Linear issue IDs in TaskList frontmatter using updateArtifactFields
- [x] **8.0** Add comprehensive error handling and validation
  - [x] 8.1 Add Linear API error handling with proper user-facing messages
  - [x] 8.2 Validate Epic exists and has required fields before push operation
  - [x] 8.3 Handle rate limiting and implement retry logic for Linear API calls
  - [x] 8.4 Add validation for Linear credentials and team access

## Acceptance Criteria Mapping

- [x] A Linear Project is created with Epic title, description, and metadata (US-057) → Tasks 4.1, 4.2
- [x] The existing Linear project is updated instead of creating a duplicate (US-057) → Tasks 4.4, 2.3
- [x] The Linear project ID is stored in the Epic's frontmatter (US-057) → Tasks 4.3
- [x] Each Feature becomes a top-level Issue linked to the Epic project (US-058) → Tasks 5.1, 5.2
- [x] The existing Linear issue is updated instead of creating a duplicate (US-058) → Tasks 2.3, 5.3
- [x] Linear issue IDs are stored in each Feature's frontmatter (US-058) → Tasks 5.3
- [x] Each Story becomes a sub-issue linked to its parent Feature issue (US-059) → Tasks 6.1, 6.2
- [x] The existing Linear sub-issue is updated instead of creating a duplicate (US-059) → Tasks 2.3, 6.3
- [x] All related Story sub-issues are visible and properly linked (US-059) → Tasks 6.2, 2.4
- [x] A TaskList sub-issue is created under the Feature with markdown checkboxes for each task (US-060) → Tasks 7.1, 7.2
- [x] The existing TaskList sub-issue is updated with current checkbox state (US-060) → Tasks 2.3, 7.4
- [x] Markdown checkboxes reflect the current completion state of each task (US-060) → Tasks 7.3
- [x] I see a complete preview of the Linear project structure without any API calls (US-061) → Tasks 3.3
- [x] I see exactly 31 items would be created (1 project + 5 features + 20 stories + 5 tasklists) (US-061) → Tasks 3.3
- [x] I see which items would be created vs updated vs skipped (US-061) → Tasks 3.3, 4.4

> **Note:** The dry-run **total** and per-level counts are computed from the epic’s actual artifacts; an epic with 1+5+20+5 items matches the example roll-up. Skipped task-list rows appear when a feature has no task checkbox content and no prior Linear task issue.

## Relevant Files

- `src/models/types.ts` — Add Linear-specific types and extend existing interfaces for Linear integration
- `src/models/schema.ts` — Optional `linear` config fields (`teamKey`, `defaultProjectLead`, `statusMap`)
- `src/services/linear-service.ts` — Linear API: auth, teams, project/issue create/update, retry
- `src/services/linear-push-service.ts` — Epic scope load, plan, push orchestration, checkbox bodies
- `src/cli/commands/linear.ts` — `init` and `push` (with `--dry-run`)
- `src/cli/index.ts` — Register new linear command following existing pattern
- `src/services/artifact-service.ts` — Use existing CRUD operations for reading artifacts and updating frontmatter

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
