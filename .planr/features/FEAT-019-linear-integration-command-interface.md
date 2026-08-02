---
id: "FEAT-019"
title: "Linear Integration Command Interface"
epicId: "EPIC-004"
owner: "Engineering"
created: "2026-04-21"
updated: "2026-04-21"
status: "planning"
---

# FEAT-019: Linear Integration Command Interface

**Epic:** [EPIC-004](../epics/EPIC-004-linear-integration-full-hierarchy-push-bidirectional-sync.md)

## Overview
Provides comprehensive command interface with dry-run modes, update-only operations, and clear documentation. Includes error handling, progress feedback, and integration ergonomics.

## Functional Requirements

- Implement `planr linear sync` command — pulls Linear state into OpenPlanr (status sync via FEAT-017; checkbox sync via FEAT-018)
- Implement `planr linear status` command — local-only mapping-table viewer (artifact id ↔ Linear id/url/state); zero API calls
- Provide `--dry-run` flag showing planned changes without execution (for `push` and `sync`)
- Support `--update-only` mode that skips creation of new Linear items
- Display clear progress feedback during long-running push/sync operations
- Generate comprehensive help documentation for all Linear commands
- Implement proper error handling with actionable user guidance

## User Stories

- [US-070: Linear sync command with dry-run mode](../stories/US-070-linear-sync-command-with-dry-run-mode.md)
- [US-071: Update-only sync mode](../stories/US-071-update-only-sync-mode.md)
- [US-072: Progress feedback during sync operations](../stories/US-072-progress-feedback-during-sync-operations.md)
- [US-073: Comprehensive help documentation](../stories/US-073-comprehensive-help-documentation.md)
- [US-074: Error handling with actionable guidance](../stories/US-074-error-handling-with-actionable-guidance.md)
- [US-075: planr linear status — mapping-table viewer](../stories/US-075-planr-linear-status-mapping-table-viewer.md)

## Dependencies
FEAT-015 (Linear Authentication and Team Selection), FEAT-016 (Four-Level Hierarchy Push to Linear), FEAT-017 (Issue Status Bidirectional Sync), FEAT-018 (Task Checkbox Bidirectional Sync)

## Technical Considerations
Command argument parsing, progress indicators for async operations, comprehensive error message formatting

## Risks
User confusion about command options and sync behavior

## Success Metrics
Dry-run mode shows complete four-level plan without making any API calls, users can successfully operate commands after reading help documentation
