---
id: "FEAT-013"
title: "Bulk Operations and Graph Integrity"
epicId: "EPIC-003"
owner: "Engineering"
created: "2026-04-21"
updated: "2026-04-21"
status: "done"
---

# FEAT-013: Bulk Operations and Graph Integrity

**Epic:** [EPIC-003](../epics/EPIC-003-plan-revision-layer-revise-command.md)

## Overview
Adds `--all` mode for repository-wide revision with safety limits, post-flight graph integrity checking, and **post-flight rollback** — the single rollback mechanism in v1, owned by this feature. Handles large-scale revision safely.

## Functional Requirements

- Implement `--all` flag for repository-wide artifact revision
- Add `max_writes_per_run` safety limit with configurable threshold
- Create post-flight graph integrity verification using existing `syncParentChildLinks` (check-only mode)
- Build **post-flight rollback** system — the only mechanism in v1 allowed to use the word "rollback" — triggered by post-write graph-integrity failures. Restores repo state via `git checkout` of affected artifact paths (requires the clean-tree gate from FEAT-011).
- Add bulk operation progress reporting and cancellation support
- Implement typed-YES confirmation for destructive bulk operations with blast-radius-appropriate summary: for `--all`, print the **full list of artifacts** that will be processed (not just a count) before the typed-YES prompt, so the user sees the exact blast radius before consenting
- In non-TTY environments (CI), skip typed-YES (matches the FEAT-011 rule) — the `--yes` flag is the pipeline contract

## User Stories

- [US-046: Repository-wide revision with --all flag and safety limits](../stories/US-046-repository-wide-revision-with-all-flag-and-safety-limits.md)
- [US-047: Post-flight graph integrity verification with automatic rollback](../stories/US-047-post-flight-graph-integrity-verification-with-automatic-rollback.md)
- [US-048: Bulk operation progress reporting and cancellation](../stories/US-048-bulk-operation-progress-reporting-and-cancellation.md)

## Dependencies
Cascade processing system, syncParentChildLinks for integrity checks, git CLI for rollback

## Technical Considerations
Bulk operations need careful memory management and progress checkpointing. Git rollback must be atomic and complete.

## Risks
Bulk mode could amplify single bad decision across many artifacts. Graph integrity failures could indicate deeper corruption.

## Success Metrics
--all mode respects write limits and triggers rollback on graph corruption. Bulk operations complete successfully or rollback cleanly.
