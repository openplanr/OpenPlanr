---
id: "BL-006"
title: "planr doctor: lint / validate planning artifacts + auto-fix safe issues"
priority: "high"
tags: ["feature", "dx", "resilience", "validation"]
status: "open"
created: "2026-04-22"
updated: "2026-04-22"
---

# BL-006: planr doctor: lint / validate planning artifacts + auto-fix safe issues

## Priority
HIGH

## Tags

- feature
- dx
- resilience
- validation

## Description

Add `planr doctor` (alias: `planr lint`) — a diagnostic command that scans every `.planr/*/` artifact and reports frontmatter / referential integrity issues in one pass, so users don't discover them piecemeal when pushing to Linear or GitHub.

### Motivation

Surfaced during EPIC-004 (Linear integration) hands-on use. A single malformed QT/BL file blocked the whole `planr linear push EPIC-003` run. The Linear integration commit includes a tolerant `readArtifact` (skip-with-warning on parse errors), but users still have no proactive way to audit their artifacts. Every agile CLI of comparable scope has a doctor/lint command — OpenPlanr should too.

### Scope

**Read-only checks (default):**

1. **Frontmatter parse errors** — YAML malformed, duplicate keys, stray `---` markers, invalid quote nesting. Exact the bug BL-003 hit in the Modul project.
2. **Missing required fields** per artifact type:
   - All: `id`, `title`
   - Feature: `epicId`
   - Story: `featureId`
   - Task: `featureId` or `storyId`
   - Backlog: `priority`
3. **ID vs filename mismatch** — file named `QT-010-*.md` but frontmatter says `id: "QT-011"`.
4. **Broken parent references** — `FEAT-003` points at `epicId: "EPIC-999"` but no such epic exists locally.
5. **Stale Linear ids** — `linearIssueId` / `linearProjectId` / `linearMilestoneId` that doesn't match UUID or `ENG-42` shape (already detected ad-hoc in `linear-mapping-service`; doctor centralises).
6. **Stale GitHub links** — `githubIssue` that references a closed/missing issue (requires GitHub auth; gated behind `--with-github`).
7. **Orphan frontmatter** — list-style leftovers like `- id: "QT-008"` from template-merge mishaps.

**`--fix` mode** (opt-in mechanical repairs only):

- Clear stale `linearIssueId` / `linearIssueIdentifier` / `linearIssueUrl` trio when the id is malformed. Safe because re-running `planr linear push` regenerates them.
- Normalise `parentEpic` → `epicId` (canonical field name — the two coexist for compat; doctor can migrate on demand).
- Does **not** auto-fix duplicate keys, missing required fields, or broken references — those need human judgment.

### Output shape

```
planr doctor — scanned 18 artifacts, 3 issues found

  ❌ backlog/BL-003-backlog-rag-proxy-host-header-spoofing-api-key.md
     Frontmatter parse error at line 13: Map keys must be unique
     Fix: remove the duplicate `- id: "QT-008"` block that follows the `---` closing marker.

  ⚠  features/FEAT-007-mcp-email-server-for-microsoft-graph.md
     epicId: "EPIC-009" references an epic that does not exist locally.
     Fix: change epicId to an existing epic, or create EPIC-009.

  ⚠  quick/QT-011-*.md
     Stale linearIssueId: "eng-42" (lowercase prefix is not a valid Linear shape).
     Fix: run `planr doctor --fix` to clear the stale fields, then re-push.
```

Exit code: 0 when clean, 1 when issues found (so CI can gate on doctor passing).

### Acceptance criteria

1. `planr doctor` runs under 2 seconds on a 50-artifact project.
2. Every check has a test that writes a deliberately-broken fixture and asserts the check fires with the expected message.
3. `planr doctor --json` emits a structured report for CI consumption.
4. `planr doctor --type <type>` scopes to one artifact kind.
5. `planr doctor --fix` is idempotent and only touches fields listed above.

### Out of scope (defer to separate backlog items)

- Lint-style style rules (heading hierarchy, list-item capitalisation, etc.) — too prescriptive for this release.
- Autofix of frontmatter parse errors — impossible to infer user intent.

### Size estimate

~2–3 days. One new command file (`src/cli/commands/doctor.ts`), a `src/services/doctor-service.ts` for each check as a pure function, and ~15 tests.

---
_Promote to agile hierarchy: `planr backlog promote BL-006 --story` or `planr backlog promote BL-006 --quick`_
_Close when done: `planr backlog close BL-006`_
