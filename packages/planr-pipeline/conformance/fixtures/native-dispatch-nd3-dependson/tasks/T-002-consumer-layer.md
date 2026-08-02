---
id: "T-002"
title: "Consumer layer"
storyId: "US-001"
specId: "SPEC-014"
slug: "consumer-layer"
schemaVersion: "1.0.0"
type: "Tech"
agent: "backend-agent"
status: "pending"
dependsOn: ["T-001"]
created: "2026-05-31"
updated: "2026-05-31"
---

# T-002 — Consumer layer

> Depends on T-001 (consumes `src/base.ts`). Must dispatch only after T-001 is `done`.

## Files

### Create

- `src/consumer.ts`

### Modify

_None._

## Subtasks

- [ ] T-002.1 — implement the consumer layer on top of the base
