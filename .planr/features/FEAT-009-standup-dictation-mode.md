---
id: "FEAT-009"
title: "Standup Dictation Mode"
epicId: "EPIC-002"
owner: "Engineering"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# FEAT-009: Standup Dictation Mode

**Epic:** [EPIC-002](../epics/EPIC-002-stakeholder-reporting-pm-intelligence-layer.md)

## Overview
Voice-to-structured-update conversion that allows developers to dictate standups and receive formatted reports. Reduces friction for daily updates while maintaining quality standards.

**v1 scope:** Transcript via `--file` or stdin, heuristic parsing into standup sections, `--edit` / `--reload-file`, and `--lint` via `planr voice standup` / `planr story standup`. Live microphone capture, bundled STT, and per-span audio replay are `@v2` in `US-028`–`US-031` Gherkin.

## Functional Requirements

- Accept voice input for standup content
- Convert speech to structured standup format
- Apply quality validation to dictated content
- Support editing of transcribed content before finalization
- Generate standard standup report from voice input

## User Stories

- [US-028: Voice Input Capture for Standup Content](../stories/US-028-voice-input-capture-for-standup-content.md)
- [US-029: Speech-to-Structured Standup Conversion](../stories/US-029-speech-to-structured-standup-conversion.md)
- [US-030: Edit Transcribed Content Before Finalization](../stories/US-030-edit-transcribed-content-before-finalization.md)
- [US-031: Quality Validation for Dictated Standups](../stories/US-031-quality-validation-for-dictated-standups.md)

## Dependencies
Report Generation Engine, Report Quality Linter, AI provider infrastructure

## Technical Considerations
Integrate speech-to-text service, implement structured parsing of natural language input

## Risks
Voice input accuracy may vary by speaker, transcription errors could impact report quality

## Success Metrics
Voice transcription accuracy >90%, dictated reports pass quality linting, user adoption for daily standups
