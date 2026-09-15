---
id: "T-002"
title: "Task with no dependsOn and no preserve"
storyId: "US-001"
slug: "minimal"
schemaVersion: "1.0.0"
type: "Tech"
agent: "backend-agent"
status: "pending"
created: "2026-01-01"
updated: "2026-01-01"
dependsOn:
  - "T-001"
rationale: "The runtime needs the selected task's concrete requirements instead of a feature-only summary."
---

# T-002 — Read active implementation context

## Objective

Expose the active task's concrete implementation context to the coding runtime.

## Files

### Create

- `src/context-reader.mjs` — reads the normalized task context.

### Modify

- `src/index.mjs` — exports the context reader.

### Preserve

- `.planr/operate/` — unrelated operating state.
- `config/legacy-preserve.json` — a body-only legacy Preserve entry.

## Technical Spec

1. Read the task objective, file lists, and parent acceptance context.
2. Apply the selected stack conventions and project-local override.
3. Use the declared database schema and design vocabulary when relevant.

## Test Requirements

- The context names both files assigned to this task.
- The context carries the parent acceptance behavior.

## Definition of Done

- The coding runtime receives the task objective and technical requirements.
- Stack, design, database, and dependency context remain discoverable.
