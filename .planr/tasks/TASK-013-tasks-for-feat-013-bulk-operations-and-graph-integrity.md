---
id: "TASK-013"
title: "Tasks for FEAT-013: Bulk Operations and Graph Integrity"

featureId: "FEAT-013"
created: "2026-04-21"
updated: "2026-04-21"
status: "done"
---

# TASK-013: Tasks for FEAT-013: Bulk Operations and Graph Integrity


**Feature:** [FEAT-013](../features/FEAT-013-bulk-operations-and-graph-integrity.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-046`
- **User Story:** `.planr/stories/US-047`
- **User Story:** `.planr/stories/US-048`
- **Gherkin:** `.planr/stories/US-046-gherkin.feature`
- **Gherkin:** `.planr/stories/US-047-gherkin.feature`
- **Gherkin:** `.planr/stories/US-048-gherkin.feature`

## Tasks

- [x] **1.0** Implement --all flag and safety limits for bulk revision
  - [x] 1.1 Add max_writes_per_run configuration option to OpenPlanrConfig interface in types.ts
  - [x] 1.2 Create revise command CLI handler with --all flag support in src/cli/commands/revise.ts
  - [x] 1.3 Implement typed-YES confirmation for `--all` using promptText from prompt-service.ts. Before the prompt, print the **full list of artifacts** that will be processed (not just a count) so the user sees exact blast radius. Detect TTY via `process.stdout.isTTY` and skip the typed-YES in non-interactive environments — the `--yes` flag alone is the pipeline contract, matching FEAT-011's rule. Single typed-YES per run, never per artifact.
  - [x] 1.4 Add safety limit enforcement that stops processing after max_writes_per_run threshold
- [x] **2.0** Build cascade processing system for repository-wide revision
  - [x] 2.1 Create cascade ordering function that processes epics → features → stories → tasks using existing listArtifacts from artifact-service.ts
  - [x] 2.2 Implement bulk revision orchestrator that processes artifacts in cascade order
  - [x] 2.3 Add progress tracking that shows completed/total artifacts and current artifact being processed
- [x] **3.0** Create post-flight graph integrity verification system
  - [x] 3.1 Implement integrity checker that uses existing syncParentChildLinks to validate artifact relationships
  - [x] 3.2 Add integrity verification that runs automatically after bulk operations complete
  - [x] 3.3 Create corruption detection logic that identifies broken parent-child links in the artifact graph
- [x] **4.0** Post-flight rollback system — **the only mechanism in v1 allowed to use the word "rollback"**
  - [x] 4.1 Capture git HEAD and affected-paths list before bulk writes begin, to anchor post-flight restoration
  - [x] 4.2 Implement automatic post-flight rollback (`git checkout -- <affected artifact paths>`) triggered by graph-integrity verification failures detected in §3.0. Emit an `AUTO_ROLLBACK` section in the audit log describing which paths were restored and why.
  - [x] 4.3 Verify repository is restored to exact previous state after rollback completes; fail loudly if any affected path still differs from pre-run HEAD
- [x] **5.0** Implement bulk operation cancellation and progress reporting
  - [x] 5.1 Add Ctrl+C signal handling for graceful cancellation of bulk operations
  - [x] 5.2 Implement safe cancellation that completes current artifact processing before stopping
  - [x] 5.3 Add cancellation summary reporting that shows completed work when operation is stopped
- [x] **6.0** Register revise command and add configuration validation
  - [x] 6.1 Register revise command in src/cli/index.ts following the existing registerXCommand pattern
  - [x] 6.2 Add max_writes_per_run validation to configSchema in src/models/schema.ts
  - [x] 6.3 Update default config generation to include max_writes_per_run with sensible default value

## Acceptance Criteria Mapping

- [ ] All artifacts are processed in cascade order and revised successfully (US-046) → Tasks 2.1, 2.2
- [ ] Processing stops after 50 writes with a clear message about the safety limit (US-046) → Tasks 1.1, 1.4
- [ ] I am prompted to type 'YES' to confirm the destructive bulk operation (US-046) → Tasks 1.3
- [ ] Graph integrity passes and changes are committed (US-047) → Tasks 3.1, 3.2
- [ ] All changes are automatically rolled back via git and the corruption is reported (US-047) → Tasks 3.3, 4.2
- [ ] The repository is restored to the exact state before the revision operation began (US-047) → Tasks 4.1, 4.3
- [ ] I see regular progress updates showing completed/total artifacts and current artifact being processed (US-048) → Tasks 2.3
- [ ] The current artifact completes processing, then the operation stops gracefully with a summary of completed work (US-048) → Tasks 5.1, 5.2, 5.3
- [ ] All completed revisions remain applied and the repository state is consistent with no partial writes (US-048) → Tasks 5.2

## Relevant Files

- `src/models/types.ts` — Add max_writes_per_run configuration option to OpenPlanrConfig interface
- `src/models/schema.ts` — Add validation for max_writes_per_run configuration option
- `src/cli/commands/revise.ts` — Create new revise command with --all flag, safety limits, and bulk operation support
- `src/cli/index.ts` — Register the new revise command following existing command registration pattern
- `src/services/artifact-service.ts` — May need to extend with bulk operation utilities or cascade processing helpers

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
