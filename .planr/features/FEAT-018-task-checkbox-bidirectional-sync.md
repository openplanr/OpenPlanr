---
id: "FEAT-018"
title: "Task Checkbox Bidirectional Sync"
epicId: "EPIC-004"
owner: "Engineering"
created: "2026-04-21"
updated: "2026-04-21"
status: "planning"
---

# FEAT-018: Task Checkbox Bidirectional Sync

**Epic:** [EPIC-004](../epics/EPIC-004-linear-integration-full-hierarchy-push-bidirectional-sync.md)

## Overview
Synchronizes individual task checkbox states between Linear TaskList issues and local markdown files. Handles three-way merge conflicts and preserves task ordering and content.

## Functional Requirements

- Parse checkbox states from Linear TaskList issue descriptions
- Update local markdown TaskList files when Linear checkboxes change
- Push local checkbox changes to Linear TaskList issue descriptions
- Match tasks by content/number with fallback strategies for drift
- Resolve three-way merge conflicts with user confirmation prompts
- Preserve task ordering and markdown formatting during sync

## User Stories

- [US-066: Parse checkbox states from Linear TaskList descriptions](../stories/US-066-parse-checkbox-states-from-linear-tasklist-descriptions.md)
- [US-067: Update local markdown when Linear checkboxes change](../stories/US-067-update-local-markdown-when-linear-checkboxes-change.md)
- [US-068: Push local checkbox changes to Linear TaskList issues](../stories/US-068-push-local-checkbox-changes-to-linear-tasklist-issues.md)
- [US-069: Resolve three-way merge conflicts with user confirmation](../stories/US-069-resolve-three-way-merge-conflicts-with-user-confirmation.md)

## Dependencies
Four-Level Hierarchy Push feature for TaskList Linear ID storage

## Technical Considerations
Markdown parsing for checkbox extraction, task matching algorithms resilient to content drift, atomic file updates

## Risks
Checkbox three-way merge conflicts during sync, task number drift breaking matching logic

## Success Metrics
Task checkbox changes sync bidirectionally between Linear and local .md files with 99% accuracy
