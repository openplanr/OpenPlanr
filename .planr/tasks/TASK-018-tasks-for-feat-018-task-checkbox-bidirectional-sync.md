---
id: "TASK-018"
title: "Tasks for FEAT-018: Task Checkbox Bidirectional Sync"

featureId: "FEAT-018"
created: "2026-04-21"
updated: "2026-04-19"
status: "done"
---

# TASK-018: Tasks for FEAT-018: Task Checkbox Bidirectional Sync


**Feature:** [FEAT-018](../features/FEAT-018-task-checkbox-bidirectional-sync.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-066`
- **User Story:** `.planr/stories/US-067`
- **User Story:** `.planr/stories/US-068`
- **User Story:** `.planr/stories/US-069`
- **Gherkin:** `.planr/stories/US-066-gherkin.feature`
- **Gherkin:** `.planr/stories/US-067-gherkin.feature`
- **Gherkin:** `.planr/stories/US-068-gherkin.feature`
- **Gherkin:** `.planr/stories/US-069-gherkin.feature`

## Tasks

- [x] **1.0** Parse checkbox states from Linear TaskList descriptions
  - [x] 1.1 Create checkbox parsing utility in src/utils/markdown.ts to extract checkbox states from Linear descriptions
  - [x] 1.2 Add task matching logic to handle content drift and ordering differences between Linear and local files
  - [x] 1.3 Add unit tests for checkbox parsing and task matching scenarios
- [x] **2.0** Implement Linear to local markdown sync
  - [x] 2.1 Create sync service in src/services/linear-sync-service.ts to handle bidirectional checkbox synchronization
  - [x] 2.2 Add function to update local TaskList markdown files when Linear checkbox states change
  - [x] 2.3 Preserve markdown formatting and task ordering during local file updates
- [x] **3.0** Implement local to Linear checkbox push
  - [x] 3.1 Add function to push local markdown checkbox changes to Linear TaskList issue descriptions
  - [x] 3.2 Preserve Linear description formatting while updating only checkbox states
  - [x] 3.3 Handle new tasks added locally by inserting them into Linear descriptions
- [x] **4.0** Implement three-way merge conflict resolution
  - [x] 4.1 Add conflict detection logic to identify when both local and Linear checkboxes changed
  - [x] 4.2 Create user prompt interface using promptConfirm from src/services/prompt-service.ts to present conflict choices
  - [x] 4.3 Apply user conflict resolution and update both local and Linear states accordingly
  - [x] 4.4 Handle multiple conflicts in a single sync session with individual prompts
- [x] **5.0** Add Linear types and integrate with existing services
  - [x] 5.1 Add Linear TaskList and checkbox state types to src/models/types.ts
  - [x] 5.2 Integrate checkbox sync with existing Linear authentication from credentials-service.ts
  - [x] 5.3 Add comprehensive unit tests for all sync scenarios and conflict resolution flows

## Acceptance Criteria Mapping

- [x] I should get an array with tasks [false, true, false] matching the checkbox states (US-066) → Tasks 1.1
- [x] I should extract only the checkbox items and preserve other content separately (US-066) → Tasks 1.1, 1.2
- [x] I should return an empty array without errors (US-066) → Tasks 1.1, 1.3
- [x] The local file should update to '- [x] Install dependencies' (US-067) → Tasks 2.2, 2.3
- [x] Tasks should match by content and update correct checkboxes regardless of position (US-067) → Tasks 1.2, 2.2
- [x] The system should use fuzzy matching or task numbers to find the correct task (US-067) → Tasks 1.2
- [x] The Linear TaskList issue description should update to show the checkbox as checked (US-068) → Tasks 3.1, 3.2
- [x] Only checkbox states should change, all other formatting should remain intact (US-068) → Tasks 3.2
- [x] The new task should be added to the Linear description in the correct position (US-068) → Tasks 3.3
- [x] I should see a conflict prompt showing local vs Linear states and be asked to choose (US-069) → Tasks 4.1, 4.2
- [x] The local file should update to match Linear and the conflict should be resolved (US-069) → Tasks 4.3
- [x] I should be prompted for each conflict individually and can resolve them one by one (US-069) → Tasks 4.4

## Relevant Files

- `src/models/types.ts` — Add Linear TaskList and checkbox state type definitions
- `src/utils/markdown.ts` — Add checkbox parsing utilities for Linear descriptions
- `src/services/linear-sync-service.ts` — Create new service to handle bidirectional checkbox synchronization
- `src/services/credentials-service.ts` — Integrate with existing Linear authentication for API access
- `src/services/prompt-service.ts` — Use existing prompt utilities for conflict resolution interface

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
