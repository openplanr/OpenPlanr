---
id: "FEAT-014"
title: "Performance and Usability Enhancements"
epicId: "EPIC-003"
owner: "Engineering"
created: "2026-04-21"
updated: "2026-04-21"
status: "done"
---

# FEAT-014: Performance and Usability Enhancements

**Epic:** [EPIC-003](../epics/EPIC-003-plan-revision-layer-revise-command.md)

## Overview
Adds cost control features, run caching, ergonomic options, and comprehensive documentation. Optimizes the revision workflow for production use.

## Functional Requirements

- Implement token budget guards and cost estimation for AI operations
- Add run cache to avoid re-processing unchanged artifacts (cache key = artifact hash + codebase digest + sources digest, stored at `.planr/reports/.revise-cache.json`)
- Create `--no-code-context` flag for faster processing when code context not needed
- Add detailed CLI help and usage examples
- Create README documentation with common workflows, troubleshooting, and a suggested git commit message convention (`chore(plan): revise <SCOPE> against codebase`) so teams have a consistent history when revise lands aligned artifacts

## User Stories

- [US-049: Token budget guards for AI operations](../stories/US-049-token-budget-guards-for-ai-operations.md)
- [US-050: Run cache for unchanged artifacts](../stories/US-050-run-cache-for-unchanged-artifacts.md)
- [US-051: Fast processing mode without code context](../stories/US-051-fast-processing-mode-without-code-context.md)
- [US-053: Comprehensive CLI help and documentation](../stories/US-053-comprehensive-cli-help-and-documentation.md)

## Dependencies
All previous features for complete functionality

## Technical Considerations
Cache invalidation strategy must account for artifact dependencies. Token estimation needs provider-specific logic.

## Risks
Cache could become stale and miss important changes. Cost controls might be too restrictive for legitimate use cases.

## Success Metrics
Run cache reduces processing time for unchanged artifacts by 80%. Token budget prevents runaway costs while allowing normal usage.
