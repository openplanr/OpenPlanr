---
id: "FEAT-016"
title: "Four-Level Hierarchy Push to Linear"
epicId: "EPIC-004"
owner: "Engineering"
created: "2026-04-21"
updated: "2026-04-19"
status: "done"
---

# FEAT-016: Four-Level Hierarchy Push to Linear

**Epic:** [EPIC-004](../epics/EPIC-004-linear-integration-full-hierarchy-push-bidirectional-sync.md)

## Overview
Implements `planr linear push` command that creates complete Linear project hierarchy. Maps Epic to Project, Features to top-level Issues, Stories to sub-issues, and TaskLists to dedicated sub-issues with markdown checkboxes.

**Shipped:** `planr linear push <epic-id> [--dry-run]`, `src/services/linear-push-service.ts`, optional `linear.teamKey` / `defaultProjectLead` / `statusMap` in config, `linear*` frontmatter on epics, features, stories, and task files. (Version bump via Changesets release workflow.)

## Functional Requirements

- Create Linear Project from Epic with proper metadata and description
- Generate top-level Issues for each Feature with Epic as parent project
- Create Story sub-issues linked to their parent Feature issues
- Generate TaskList sub-issues per Feature containing markdown checkboxes for all tasks
- Store Linear IDs in artifact frontmatter for future sync operations
- Support dry-run mode showing complete plan without API calls

## User Stories

- [US-057: Create Linear project from Epic with metadata](../stories/US-057-create-linear-project-from-epic-with-metadata.md)
- [US-058: Create Feature issues linked to Epic project](../stories/US-058-create-feature-issues-linked-to-epic-project.md)
- [US-059: Create Story sub-issues linked to Feature issues](../stories/US-059-create-story-sub-issues-linked-to-feature-issues.md)
- [US-060: Create TaskList sub-issues with markdown checkboxes](../stories/US-060-create-tasklist-sub-issues-with-markdown-checkboxes.md)
- [US-061: Support dry-run mode for push operations](../stories/US-061-support-dry-run-mode-for-push-operations.md)

## Dependencies
Linear Authentication feature, existing artifact frontmatter system

## Technical Considerations
@linear/sdk mutations for project and issue creation, proper parent-child linking via Linear's hierarchy system

## Risks
Linear rate limits on large syncs, idempotency issues if frontmatter IDs become stale

## Success Metrics
Medium project creates exactly 31 Linear items (1 project + 5 features + 20 stories + 5 tasklists), re-running push is idempotent with zero creates when unchanged
