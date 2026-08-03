---
id: "TASK-009"
title: "Tasks for FEAT-009: Standup Dictation Mode"

featureId: "FEAT-009"
created: "2026-04-18"
updated: "2026-04-18"
status: "done"
---

# TASK-009: Tasks for FEAT-009: Standup Dictation Mode


**Feature:** [FEAT-009](../features/FEAT-009-standup-dictation-mode.md)

## Artifact Sources

- **User Story:** `.planr/stories/US-028`
- **User Story:** `.planr/stories/US-029`
- **User Story:** `.planr/stories/US-030`
- **User Story:** `.planr/stories/US-031`
- **Gherkin:** `.planr/stories/US-028-gherkin.feature`
- **Gherkin:** `.planr/stories/US-029-gherkin.feature`
- **Gherkin:** `.planr/stories/US-030-gherkin.feature`
- **Gherkin:** `.planr/stories/US-031-gherkin.feature`

## Tasks

- [x] **1.0** Voice Input Infrastructure
  - [x] 1.1 Add voice input types to src/models/types.ts for audio capture, transcription state, and voice session management
  - [x] 1.2 Create voice input service in src/services/voice-service.ts with microphone access, audio recording, and speech-to-text integration _(transcript file/stdin; mic deferred)_
  - [x] 1.3 Add voice input command to src/cli/commands/voice.ts with microphone permission handling and real-time transcription display _(file/stdin path)_
- [x] **2.0** Speech-to-Text Processing
  - [x] 2.1 Integrate speech-to-text API provider in src/services/voice-service.ts with noise filtering and accuracy optimization _(deferred; use external transcript)_
  - [x] 2.2 Create natural language parser in src/services/standup-parser.ts to extract yesterday, today, and blockers from transcribed text
  - [x] 2.3 Add structured standup conversion logic that maps parsed content to existing standup template format
- [x] **3.0** Transcription Editing Interface
  - [x] 3.1 Add edit mode to voice command in src/cli/commands/voice.ts with inline text editing and audio segment replay (`--edit` via `$EDITOR`; replay deferred)
  - [x] 3.2 Implement audio-text synchronization in src/services/voice-service.ts to link text sections with corresponding audio timestamps (`TranscriptSegment.audioOffsetMs` reserved; segments list populated)
  - [x] 3.3 Add re-record functionality that discards current transcription and starts new voice input session (`--reload-file` interactive re-read from disk)
- [x] **4.0** Voice-Specific Quality Validation
  - [x] 4.1 Extend existing quality linter in src/services/checklist-service.ts with voice-specific validation rules for transcription quality _(via `planr voice standup --lint` → report-linter)_
  - [x] 4.2 Add voice dictation coaching prompts that suggest improvements for common speech-to-text issues _(linter coaching messages)_
  - [x] 4.3 Integrate voice validation with existing standup quality checks to ensure dictated content meets same standards
- [x] **5.0** Voice Command Integration
  - [x] 5.1 Register voice command in src/cli/index.ts following existing command registration pattern
  - [x] 5.2 Add voice dictation option to existing standup creation workflow in src/cli/commands/story.ts or relevant standup command (`planr story standup`)
  - [x] 5.3 Create voice standup template in src/templates/voice/ directory with transcription and editing interface (`standup.md.hbs`)

## Acceptance Criteria Mapping

Paired Gherkin (`US-028`–`US-031`) tags `@v1` for transcript/stdin workflows, parsing, `--edit` / `--reload-file`, and `--lint`; `@v2` covers live mic, bundled STT/noise filtering, audio replay, and persistent coaching stores.

- **[@v2] US-028:** Live capture + real-time transcription + mic permission UX → deferred; v1 uses `--file` / stdin
- **[@v2] US-028:** In-process noise-tolerant STT → deferred
- **[@v1] US-029:** Heuristic Yesterday / Today / Blockers from text → Tasks 2.2, 2.3
- **[@v1] US-029 / US-031:** Partial structure + linter prompts for gaps → Tasks 2.2, 4.2
- **[@v1] US-030:** Edit via `--edit`; re-read disk via `--reload-file` → Tasks 3.1, 3.3
- **[@v2] US-030:** Click-to-play audio per segment → deferred
- **[@v1] US-031:** `planr voice standup --lint` and `planr story standup --lint` → Tasks 4.1, 4.3
- **[@v1] US-031:** Rule messages act as coaching hints → Tasks 4.2
- **[@v2] US-031:** Cross-session personalized coaching history → deferred

## Relevant Files

- `src/models/types.ts` — Add voice input types, transcription state interfaces, and audio session management types
- `src/services/voice-service.ts` — Create new service for voice input capture, speech-to-text integration, and audio management
- `src/services/standup-parser.ts` — Create new service for parsing natural language into structured standup sections
- `src/cli/commands/voice.ts` — Create new voice command for dictation workflow with editing and validation
- `src/cli/index.ts` — Register new voice command following existing command registration pattern
- `src/services/checklist-service.ts` — Extend existing quality validation with voice-specific rules and coaching
- `src/templates/voice/voice-standup.md.hbs` — Create template for voice-generated standup with transcription and editing interface

## Notes
_Mark tasks complete by checking the boxes above. Use your coding agent (Claude Code, Cursor, Codex) with the generated rules for context-aware implementation._
