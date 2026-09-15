---
id: "SPEC-001"
title: "Legacy Plan"
slug: "legacy-plan"
schemaVersion: "1.0.0"
status: "decomposed"
---

## Context & Goal

A feature planned while SHIP still tracked candidates, receipts, and correction
counters. It must remain readable after those fields stopped being required.

## Functional Requirements

### FR-01 — Legacy plans remain readable

The reader tolerates removed bookkeeping fields.

## Constraints

- Planning artifacts are read, never rewritten, when a context is built.

## Acceptance Criteria

- Given a plan authored under the old orchestration fields, when its working context is
  built, then it loads without requiring any of them.
- Given a task that declares no dependency, when the graph is built, then it carries no dependency row.
