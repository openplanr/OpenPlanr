---
id: "EPIC-002"
title: "Stakeholder Reporting & PM Intelligence Layer"
owner: "Engineering"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
project: "OpenPlanr"
---

# EPIC-002: Stakeholder Reporting & PM Intelligence Layer

## Business Value

Eliminates the friction between developer productivity and stakeholder communication by automatically generating evidence-backed status reports. Reduces PM overhead while ensuring stakeholders receive trustworthy, actionable updates that improve project transparency and decision-making.

## Target Users

Individual developers generating standups and weekly updates, Engineering managers needing team-level rollups with automated risk detection, Stakeholders receiving polished reports without requiring CLI access

## Problem Statement

Developers hate writing status updates and PMs hate chasing them, while stakeholders receive technically present but informationally useless updates with vague summaries and no actionable content. No developer-friendly tool exists to bridge raw engineering signals and structured stakeholder narratives without forcing context-switching to PM-heavy UIs.

## Solution Overview

Build a CLI-first reporting system that generates structured, evidence-linked reports from existing planr artifacts, GitHub activity, and sprint data. Acts as a 'linter for status reports' that refuses to ship sloppy updates and coaches developers into producing concise, deliverable-focused reports backed by traceable evidence.

## Success Criteria

- Developer can generate stakeholder-ready weekly update in under 30 seconds
- Every claim in generated reports links to at least one evidence source
- Report quality linter catches 90%+ of informationally useless updates
- Generated reports are indistinguishable from hand-written PM updates in blind tests
- CLI workflow requires zero context-switching to PM tools

### v1 vs v2

**v1 (shipped in this repo):** `planr report` with six template types, Markdown + HTML, optional GitHub signals, evidence appendix + `--strict-evidence`, report linter + `report-linter`, Slack Incoming Webhook + GitHub issue push, local `.planr/reports/` artifacts, and standup flows via transcript/stdin + `planr voice` / `planr story standup` with `--lint`. User stories `US-014`–`US-031` pair with Gherkin where scenarios tagged `@v1` describe this behavior.

**v2 / stretch:** Bundled PDF, SMTP email, live microphone + bundled STT, richer HTML tooltips, Slack OAuth and multi-channel routing, git-native report commits without issues, and persistent cross-session coaching history — captured as `@v2` in the same Gherkin files and explicit CLI errors where not implemented.

## Key Features

- Report Generation Engine with 6 template types (Sprint, Weekly, Executive, Standup, Retrospective, Release Notes)
- Evidence-Linked Claims system with traceable sources for every statement
- Report Quality Linter with configurable validation rules
- Context Pack System assembling data from multiple sources
- Multi-format Delivery & Distribution (Markdown, HTML/PDF, GitHub, Slack)
- Standup Dictation Mode with voice-to-structured-update conversion

## Dependencies

Existing planr artifact hierarchy, GitHub service integration, AI provider infrastructure, Handlebars template system

## Risks

AI hallucination without evidence backing, quality linter rule complexity, stakeholder adoption of new report formats, voice input accuracy for dictation mode

## Features

- [FEAT-005: Report Generation Engine with Template System](../features/FEAT-005-report-generation-engine-with-template-system.md)
- [FEAT-006: Evidence-Linked Claims System](../features/FEAT-006-evidence-linked-claims-system.md)
- [FEAT-007: Report Quality Linter with Validation Rules](../features/FEAT-007-report-quality-linter-with-validation-rules.md)
- [FEAT-008: Multi-format Delivery & Distribution](../features/FEAT-008-multi-format-delivery-distribution.md)
- [FEAT-009: Standup Dictation Mode](../features/FEAT-009-standup-dictation-mode.md)
