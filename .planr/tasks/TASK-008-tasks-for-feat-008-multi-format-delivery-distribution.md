---
id: "TASK-008"
title: "Tasks for FEAT-008: Multi-format Delivery & Distribution"
featureId: "FEAT-008"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# TASK-008: Tasks for FEAT-008: Multi-format Delivery & Distribution

**Feature:** [FEAT-008](../features/FEAT-008-multi-format-delivery-distribution.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-024`
- **User Story:** `.planr/stories/US-025`
- **User Story:** `.planr/stories/US-026`
- **User Story:** `.planr/stories/US-027`
- **Gherkin:** `.planr/stories/US-024-gherkin.feature`
- **Gherkin:** `.planr/stories/US-025-gherkin.feature`
- **Gherkin:** `.planr/stories/US-026-gherkin.feature`
- **Gherkin:** `.planr/stories/US-027-gherkin.feature`

## Tasks

- **1.0** Add export types and interfaces
  - 1.1 Add export format types and configuration interfaces to src/models/types.ts
  - 1.2 Add distribution channel types and configuration interfaces to src/models/types.ts
  - 1.3 Add export result and error types to src/models/types.ts
- **2.0** Create export service for format conversion
  - 2.1 Create src/services/export-service.ts with format conversion functions for Markdown, HTML, and PDF
  - 2.2 Implement HTML template rendering using existing template service patterns
  - 2.3 Add PDF generation capability using puppeteer or similar library
  - 2.4 Add format validation and error handling for export failures
- **3.0** Create distribution service for channel integrations
  - 3.1 Create src/services/distribution-service.ts with channel-specific delivery functions
  - 3.2 Extend src/services/github-service.ts with file commit functionality for report archiving
  - 3.3 Create Slack integration service following existing service patterns
  - 3.4 Create email service with SMTP support and attachment handling
- **4.0** Create export command interface
  - 4.1 Create src/cli/commands/export.ts with format and distribution options
  - 4.2 Add export command registration to src/cli/index.ts
  - 4.3 Implement interactive prompts for format selection and distribution configuration
- **5.0** Add export templates and configuration
  - 5.1 Create HTML export template in src/templates/export/ directory
  - 5.2 Add distribution configuration schema to src/models/schema.ts
  - 5.3 Update OpenPlanrConfig interface to include export and distribution settings

## Acceptance Criteria Mapping

Source of truth: `.planr/stories/US-024-gherkin.feature` … `US-027-gherkin.feature` — `@v1` matches shipped CLI; `@v2` defers bundled PDF, SMTP, OAuth/multi-channel Slack, and git-native commits without issues.

- **[@v1] US-024:** Markdown + HTML outputs; `--format pdf` exits with explicit “not in this build” guidance → `planr report`, `report.ts`
- **[@v2] US-024:** Bundled PDF with print-quality layout → not shipped
- **[@v1] US-025:** Slack Incoming Webhook POST; truncated payload on size; webhook failures surface HTTP errors → `distribution-service.ts`
- **[@v1] US-025:** `--dry-run` succeeds without a configured webhook (no network) → `distribution-service.ts`
- **[@v2] US-025:** OAuth installs, per-channel executive routing → not shipped
- **[@v1] US-026:** Timestamped files under `.planr/reports/`; optional `--push github` creates an issue → `report-service.ts`, `distribution-service.ts`
- **[@v2] US-026:** Repository commit of report files without an issue → not shipped
- **[@v1] US-027:** Clear “email not configured / SMTP not implemented” messaging → `distribution-service.ts`
- **[@v2] US-027:** SMTP HTML + attachments + retry UX → not shipped

## Relevant Files

- `src/models/types.ts` — Add export format types, distribution channel interfaces, and configuration types
- `src/models/schema.ts` — Add validation schemas for export and distribution configuration
- `src/services/export-service.ts` — New service for handling format conversion (Markdown, HTML, PDF)
- `src/services/distribution-service.ts` — New service for managing delivery to different channels
- `src/services/github-service.ts` — Extend existing GitHub service with file commit functionality
- `src/cli/commands/export.ts` — New command for export and distribution functionality
- `src/cli/index.ts` — Register the new export command
- `src/templates/export/report.html.hbs` — HTML template for report export formatting

## Notes

**Shipped:** `planr report` writes Markdown + HTML; `--push github` and `--push slack` (incoming webhook in `distribution.slackWebhookUrl`). Config schema: `reports`, `distribution` in `.planr/config.json`.

**Deferred:** PDF generation (no bundled headless browser); SMTP email (clear error if configured); committing report files via Git tree API (use GitHub issue or local `.planr/reports/` + git manually).

*Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation.*