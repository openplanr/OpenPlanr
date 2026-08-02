---
id: "TASK-014"
title: "Tasks for FEAT-014: Performance and Usability Enhancements"

featureId: "FEAT-014"
created: "2026-04-21"
updated: "2026-04-21"
status: "done"
---

# TASK-014: Tasks for FEAT-014: Performance and Usability Enhancements


**Feature:** [FEAT-014](../features/FEAT-014-performance-and-usability-enhancements.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-049`
- **User Story:** `.planr/stories/US-050`
- **User Story:** `.planr/stories/US-051`
- **User Story:** `.planr/stories/US-053`
- **Gherkin:** `.planr/stories/US-049-gherkin.feature`
- **Gherkin:** `.planr/stories/US-050-gherkin.feature`
- **Gherkin:** `.planr/stories/US-051-gherkin.feature`
- **Gherkin:** `.planr/stories/US-053-gherkin.feature`

## Tasks

- [x] **1.0** Token Budget Controls
  - [x] 1.1 Add token budget types and interfaces to src/models/types.ts
  - [x] 1.2 Create token estimation service with provider-specific logic
  - [x] 1.3 Add budget validation to revise command with warning at 80% and blocking at 100%
  - [x] 1.4 Add budget display and remaining budget tracking to command output
- [x] **2.0** Run Cache Implementation
  - [x] 2.1 Add cache types and configuration to src/models/types.ts
  - [x] 2.2 Create cache service with content hash and dependency tracking
  - [x] 2.3 Integrate cache hit/miss logic into revise processing flow
  - [x] 2.4 Add cache invalidation for dependency changes and file modifications
- [x] **3.0** Fast Processing Mode
  - [x] 3.1 Add --no-code-context flag to revise command options
  - [x] 3.2 Modify context building to skip codebase analysis when flag is set
  - [x] 3.3 Ensure artifact chain and sibling context still included in fast mode
- [x] **4.0** Enhanced CLI Help and Documentation
  - [x] 4.1 Enhance revise command help with detailed usage examples and options
  - [x] 4.2 Update README with revise command workflows and troubleshooting guide
  - [x] 4.3 Add performance tips and common usage patterns to documentation
  - [x] 4.4 Document suggested git commit message convention (`chore(plan): revise <SCOPE> against codebase`) so teams get consistent history after revise runs
  - [x] 4.5 Extend audit log formatting (token usage, cache hit/miss stats) on top of the core audit log shipped in TASK-011 §6.0

## Acceptance Criteria Mapping

- [ ] A token budget of 10000 tokens is configured and operations estimated at 15000 tokens are blocked (US-049) → Tasks 1.1, 1.2, 1.3
- [ ] A token budget of 10000 tokens is configured and operations estimated at 5000 tokens proceed with remaining budget display (US-049) → Tasks 1.1, 1.2, 1.4
- [ ] A token budget of 10000 tokens is configured and operations estimated at 8500 tokens show warning but proceed (US-049) → Tasks 1.1, 1.2, 1.3
- [ ] An artifact was previously processed and cached, and running planr revise on the same unchanged artifact skips processing with cache hit message (US-050) → Tasks 2.1, 2.2, 2.3
- [ ] An artifact has been modified since last cache and running planr revise processes and updates cache (US-050) → Tasks 2.1, 2.2, 2.4
- [ ] An artifact is cached but its dependency has changed, and running planr revise processes despite being cached (US-050) → Tasks 2.1, 2.2, 2.4
- [ ] Running planr revise --no-code-context processes without gathering codebase context (US-051) → Tasks 3.1, 3.2
- [ ] Running planr revise --no-code-context includes artifact chain and siblings but no code files (US-051) → Tasks 3.1, 3.2, 3.3
- [ ] Running planr revise --help displays detailed usage examples and options (US-053) → Tasks 4.1
- [ ] Reading the README documentation provides common workflows and troubleshooting guidance (US-053) → Tasks 4.2, 4.3
- [ ] README includes suggested git commit message convention for revise runs (US-053) → Tasks 4.4

## Relevant Files

- `src/models/types.ts` — Add token budget and cache type definitions (audit log types live in TASK-011 §6.1)
- `src/services/token-budget-service.ts` — Create service for token estimation and budget validation
- `src/services/cache-service.ts` — Create service for artifact caching with dependency tracking
- `src/services/audit-log-service.ts` — Extend the core audit log service (shipped in TASK-011 §6.2) with token usage and cache hit/miss stats
- `src/cli/commands/revise.ts` — Add new command flags and integrate performance enhancements
- `src/cli/index.ts` — Register the new revise command
- `README.md` — Add revise command documentation, workflows, and suggested git commit message convention

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
