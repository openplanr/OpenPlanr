---
id: "EPIC-004"
title: "Linear Integration - Full Hierarchy Push & Bidirectional Sync"
owner: "Engineering"
created: "2026-04-21"
updated: "2026-04-21"
status: "planning"
project: "OpenPlanr"
---

# EPIC-004: Linear Integration - Full Hierarchy Push & Bidirectional Sync

## Business Value
Bridges the gap between OpenPlanr hierarchies in `.planr/` and Linear where product managers and sprint planners work. Eliminates manual copy-paste workflows and prevents Linear from drifting from the plan by providing full-hierarchy push plus bidirectional sync for task checkboxes and issue status.

## Target Users
Product managers who track epics and features in Linear, sprint planners who estimate and assign stories, developers who manage task checklists, and engineering teams using Linear for project management

## Problem Statement
OpenPlanr hierarchies live in `.planr/` where developers and AI agents can reach them, but product managers and sprint planners work in Linear. Today the gap is bridged by copy-paste or ignored entirely, causing Linear to drift from the plan. Teams need seamless integration that respects both systems' strengths.

## Solution Overview
Implement `planr linear` command that mirrors OpenPlanr hierarchy into Linear's native constructs: Epic → Project, Feature → top-level Issue, Story → sub-issue, TaskList → dedicated sub-issue per feature with markdown checkboxes. Provides one-way push for all artifacts and bidirectional sync for task checkbox state and issue status.

## Success Criteria

- Users can run `planr linear push EPIC-XXX` to create complete Linear project with proper parent-child linking
- Task checkbox changes sync bidirectionally between Linear and local `.md` files
- Issue status updates in Linear automatically sync back to OpenPlanr frontmatter
- Re-running push commands is idempotent with zero creates/updates when nothing changed
- Medium project creates exactly 31 Linear items (1 project + 5 features + 20 stories + 5 tasklists)
- Dry-run mode shows complete four-level plan without making any API calls
- Authentication and team selection completes in under 90 seconds for new users

## Key Features

- Authentication and Team Selection (`planr linear init`) — FEAT-015
- Four-Level Hierarchy Push (`planr linear push`) — FEAT-016
- Issue Status Sync, Linear → OpenPlanr (`planr linear sync`) — FEAT-017
- Task Checkbox Bidirectional Sync (`planr linear sync`) — FEAT-018
- Command Interface: dry-run / update-only / status viewer / help / error handling — FEAT-019

## Dependencies
@linear/sdk for GraphQL API access, existing credentials-service.ts for PAT storage, existing artifact frontmatter system for storing Linear IDs

## Risks
Checkbox three-way merge conflicts during sync, Linear rate limits on large syncs, task number drift breaking matching logic, idempotency issues if frontmatter IDs become stale, PAT scope permissions causing cryptic errors

## Features

- [FEAT-015: Linear Authentication and Team Selection](../features/FEAT-015-linear-authentication-and-team-selection.md)
- [FEAT-016: Four-Level Hierarchy Push to Linear](../features/FEAT-016-four-level-hierarchy-push-to-linear.md)
- [FEAT-017: Issue Status Bidirectional Sync](../features/FEAT-017-issue-status-bidirectional-sync.md)
- [FEAT-018: Task Checkbox Bidirectional Sync](../features/FEAT-018-task-checkbox-bidirectional-sync.md)
- [FEAT-019: Linear Integration Command Interface](../features/FEAT-019-linear-integration-command-interface.md)
