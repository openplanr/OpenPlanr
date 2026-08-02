---
id: "TASK-011"
title: "Tasks for FEAT-011: Safety Gates and Atomic Write System"

featureId: "FEAT-011"
created: "2026-04-21"
updated: "2026-04-21"
status: "done"
---

# TASK-011: Tasks for FEAT-011: Safety Gates and Atomic Write System


**Feature:** [FEAT-011](../features/FEAT-011-safety-gates-and-atomic-write-system.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-037`
- **User Story:** `.planr/stories/US-038`
- **User Story:** `.planr/stories/US-039`
- **User Story:** `.planr/stories/US-040`
- **User Story:** `.planr/stories/US-052`
- **Gherkin:** `.planr/stories/US-037-gherkin.feature`
- **Gherkin:** `.planr/stories/US-038-gherkin.feature`
- **Gherkin:** `.planr/stories/US-039-gherkin.feature`
- **Gherkin:** `.planr/stories/US-040-gherkin.feature`
- **Gherkin:** `.planr/stories/US-052-gherkin.feature`

## Tasks

- [x] **1.0** Evidence Verification System
  - [x] 1.1 Add evidence types to src/models/types.ts
  - [x] 1.2 Create evidence verification service in src/services/evidence-service.ts
  - [x] 1.3 Add evidence validation functions for file paths, code snippets, and metadata
- [x] **2.0** Git Clean Tree Gate
  - [x] 2.1 Add git status checking functions to src/services/git-service.ts
  - [x] 2.2 Implement clean tree validation with --allow-dirty override
  - [x] 2.3 Add git tree status types to src/models/types.ts
- [x] **3.0** Atomic Write System with Backup
  - [x] 3.1 Create atomic write service in src/services/atomic-write-service.ts
  - [x] 3.2 Implement backup creation before file modification (sidecar copy for manual recovery, not for automated rollback)
  - [x] 3.3 Add atomic file operations with temp file + fsync + rename — atomicity means no partial writes ever exist on disk
  - [x] 3.4 Handle fs-level write errors: the temp file is cleaned up and the original is untouched. This is atomicity, not rollback — the word "rollback" is reserved for TASK-013 §4.0's post-flight mechanism.
- [x] **4.0** Diff Preview System
  - [x] 4.1 Add diff generation utilities to src/utils/diff.ts
  - [x] 4.2 Create diff preview service in src/services/diff-service.ts
  - [x] 4.3 Add colored diff output formatting
- [x] **5.0** Interactive Confirmation System
  - [x] 5.1 Extend src/services/prompt-service.ts with diff confirmation prompts — concrete menu `[a]pply / [s]kip / [e]dit rationale / [d]iff again / [q]uit`
  - [x] 5.2 Add --yes bypass mode: in an interactive TTY (`process.stdout.isTTY === true`), print an upfront summary and block on a single typed "YES" before the first write. In non-TTY environments (CI, pipes), skip the typed-YES — the `--yes` flag alone is the contract with the pipeline.
  - [x] 5.3 Implement change approval/rejection workflow — decline (`s`/`q`) prevents the write entirely, so nothing needs to be reverted
- [x] **6.0** Audit Log Output (core writing/formatting — always-on side effect of every run)
  - [x] 6.1 Add audit log types and format options to src/models/types.ts (ReviseAudit, ReviseAuditEntry, AuditFormat)
  - [x] 6.2 Create audit log service in src/services/audit-log-service.ts supporting both Markdown and JSON formats
  - [x] 6.3 Integrate audit log emission into revise orchestration so applied / skipped / flagged artifacts with rationale, evidence, and diffs are recorded on every run (dry-run included)
  - [x] 6.4 Add --audit-format option to revise command for format selection
- [x] **7.0** Integration and Testing
  - [x] 7.1 Add safety gate types and interfaces to src/models/types.ts
  - [x] 7.2 Create comprehensive test suite for all safety gates
  - [x] 7.3 Add error handling and logging for safety gate failures

## Acceptance Criteria Mapping

- [ ] AI proposes a change citing an existing file path and code snippet (US-037) → Tasks 1.2, 1.3
- [ ] The evidence verifier checks the citation (US-037) → Tasks 1.2, 1.3
- [ ] The change is approved for diff preview (US-037) → Tasks 1.2, 4.2
- [ ] AI proposes a change citing a non-existent file or incorrect code snippet (US-037) → Tasks 1.2, 1.3
- [ ] The change is dropped and logged as unverifiable (US-037) → Tasks 1.2, 7.3
- [ ] AI proposes a change with fabricated evidence (US-037) → Tasks 1.2, 1.3
- [ ] The change is rejected and the hallucination is flagged in audit log (US-037) → Tasks 1.2, 7.3
- [ ] The git working directory is clean (US-038) → Tasks 2.1, 2.2
- [ ] The revision process continues normally (US-038) → Tasks 2.2
- [ ] The git working directory has uncommitted changes (US-038) → Tasks 2.1, 2.2
- [ ] The command fails with a clean tree requirement message (US-038) → Tasks 2.2, 7.3
- [ ] I run planr revise with --allow-dirty flag (US-038) → Tasks 2.2
- [ ] The revision process continues with a warning about dirty tree (US-038) → Tasks 2.2, 7.3
- [ ] A revision is approved and ready to write (US-039) → Tasks 3.1, 3.2
- [ ] A backup is created, the file is updated atomically, and the backup is retained (US-039) → Tasks 3.2, 3.3
- [ ] A revision write encounters an error during file modification (US-039) → Tasks 3.4, 7.3
- [ ] The original file is restored from backup and the error is logged (US-039) → Tasks 3.4, 7.3
- [ ] Temporary files are cleaned up while backup sidecars are preserved for manual recovery (US-039) → Tasks 3.4
- [ ] A revision passes evidence verification (US-040) → Tasks 1.2, 4.2
- [ ] The system shows the diff preview (US-040) → Tasks 4.2, 4.3
- [ ] I am prompted to confirm the change and can approve or reject it (US-040) → Tasks 5.1, 5.3
- [ ] I run planr revise with --yes flag (US-040) → Tasks 5.2
- [ ] The change is applied automatically without interactive confirmation (US-040) → Tasks 5.2
- [ ] I reject the change at the confirmation prompt (US-040) → Tasks 5.3
- [ ] The original file remains unchanged and the rejection is logged (US-040) → Tasks 5.3, 7.3
- [ ] Running a revision operation on multiple artifacts creates an audit log with rationale, evidence, and diffs for each artifact (US-052) → Tasks 6.1, 6.2, 6.3
- [ ] Specifying --audit-format json or markdown generates the audit log in the requested format (US-052) → Tasks 6.1, 6.2, 6.4
- [ ] Dry-run mode still emits an audit log describing would-apply / skipped / flagged entries (US-052) → Tasks 6.2, 6.3

## Relevant Files

- `src/models/types.ts` — Add evidence types, git status types, and safety gate interfaces
- `src/services/evidence-service.ts` — Create evidence verification service for validating AI citations
- `src/services/git-service.ts` — Create git service for checking working directory status
- `src/services/atomic-write-service.ts` — Create atomic write service with sidecar backup. Atomicity (temp file + rename) means there is nothing to "roll back" at the file level; the word "rollback" is reserved for the post-flight git mechanism in TASK-013 §4.0.
- `src/utils/diff.ts` — Create diff generation utilities for change preview
- `src/services/diff-service.ts` — Create diff preview service for showing proposed changes
- `src/services/prompt-service.ts` — Extend with diff confirmation prompts and --yes mode support
- `src/services/audit-log-service.ts` — Create audit log service that renders applied / skipped / flagged entries as Markdown or JSON; invoked on every revise run including dry-run

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
