---
id: "FEAT-011"
title: "Safety Gates and Atomic Write System"
epicId: "EPIC-003"
owner: "Engineering"
created: "2026-04-21"
updated: "2026-04-21"
status: "done"
---

# FEAT-011: Safety Gates and Atomic Write System

**Epic:** [EPIC-003](../epics/EPIC-003-plan-revision-layer-revise-command.md)

## Overview
Adds evidence verification, git clean-tree requirements, atomic file operations with backup, and interactive confirmation workflow. Ensures revisions are safe and reversible.

## Functional Requirements

- Implement evidence verifier that validates AI citations against actual codebase content
- Add clean git tree requirement with --allow-dirty override option
- Create atomic write system (temp file → fsync → rename) with a sidecar backup copy before each modification. **The atomic write is the atomicity guarantee** — if an fs-level error occurs mid-write, the original file was never touched and the temp file is cleaned up. The word "rollback" is reserved for FEAT-013's post-flight git mechanism and is not used here.
- Build diff preview showing proposed changes before confirmation, with a concrete menu: `[a]pply / [s]kip / [e]dit rationale / [d]iff again / [q]uit`. A decline (`s` or `q`) prevents the write entirely — nothing is written, so nothing needs to be reverted.
- Add `--yes` bypass mode for non-interactive confirmation. In an interactive TTY (`process.stdout.isTTY === true`), revise still prints an upfront summary — `"About to revise N artifacts in scope X. Continue? Type YES."` — and blocks on a typed "YES" to catch muscle-memory mistakes. In non-TTY environments (pipelines, CI), the typed-YES is skipped entirely — the `--yes` flag itself is the contract with the pipeline, and PR review is the upstream human gate. Single typed-YES per run, never per artifact.
- Emit the audit log (Markdown and JSON formats) as an always-on side effect of every run, dry-run included — captures applied / skipped / flagged artifacts, rationale, evidence, diffs, token usage

## User Stories

- [US-037: Evidence Verifier for AI Citations](../stories/US-037-evidence-verifier-for-ai-citations.md)
- [US-038: Clean Git Tree Requirement with Override](../stories/US-038-clean-git-tree-requirement-with-override.md)
- [US-039: Atomic Write System with Backup](../stories/US-039-atomic-write-system-with-backup.md)
- [US-040: Diff Preview and Interactive Confirmation](../stories/US-040-diff-preview-and-interactive-confirmation.md)
- [US-052: Comprehensive audit log output](../stories/US-052-comprehensive-audit-log-output.md)

## Dependencies
Core revise engine, git CLI integration, prompt-service for interactive prompts

## Technical Considerations
Evidence verifier must handle different evidence types (file paths, code snippets, metadata). Atomic writes need proper cleanup on failure.

## Risks
Evidence verifier could be too strict and block valid changes, or too permissive and allow hallucinations

## Success Metrics
Evidence verifier correctly drops planted hallucinations while preserving valid changes. Clean tree gate prevents accidental overwrites.
