---
id: "SPEC-001"
title: "Todo feature — conformance test fixture"
slug: "todo-feature"
schemaVersion: "1.0.0"
status: "shaped"
priority: "P1"
created: "2026-04-29"
updated: "2026-04-29"
ui_files: []
tech_dependencies: []
---

# SPEC-001: Todo feature — conformance test fixture

## Context & Goal

A deliberately tiny feature used by the OpenPlanr Protocol conformance test runner. Adds a single function that appends a todo string to an in-memory array and returns the resulting list. No persistence, no UI, no API.

The fixture exercises the minimum viable PLAN + SHIP path: 1 functional requirement → 1 User Story → 1 Tech task → frontend-agent skipped (no UI) → backend-agent runs → qa-agent gate → marker written. No PNGs (designer-agent skipped). No DB (db-agent skipped).

## Functional Requirements

- The system must expose a function `addTodo(list: string[], text: string): string[]` that returns a new array containing all original items plus the new text appended at the end.
- The function must NOT mutate the input array.

## Business Rules

- Function is pure (no side effects).
- TypeScript strict; build via `npx tsc --noEmit` must pass.
- Tests via `npx vitest run` must pass.
- No external dependencies — uses only the Node.js standard library + Vitest for testing.

## User Flows

**Flow 1 — Append to empty list:**
1. Caller invokes `addTodo([], "buy milk")`.
2. System returns `["buy milk"]`.

**Flow 2 — Append to existing list:**
1. Caller invokes `addTodo(["a", "b"], "c")`.
2. System returns `["a", "b", "c"]`.
3. The original `["a", "b"]` array is unchanged.

## Out of Scope

- Persistence (database, file system, in-memory store)
- UI (no React, no DOM, no terminal output)
- HTTP API
- Multi-user concerns
- Any deletion, update, or query operations
- Validation of input (empty strings, duplicates, etc.)

## Acceptance Criteria

- [ ] Given an empty list, when `addTodo([], "buy milk")` is called, then it returns `["buy milk"]`.
- [ ] Given a list `["a", "b"]`, when `addTodo(["a", "b"], "c")` is called, then it returns `["a", "b", "c"]`.
- [ ] Given a list `["a", "b"]`, when `addTodo` is called and the result is captured, then the original `["a", "b"]` reference is unchanged (immutability).
- [ ] Given `npx tsc --noEmit` is run, when it completes, then it exits 0.
- [ ] Given `npx vitest run` is run, when it completes, then all tests pass with exit 0.

## Notes for Decomposition

- Single Tech task. No UI task (no PNGs, no DOM concerns).
- Suggested file layout:
  - `src/todo.ts` — exports `addTodo`
  - `tests/todo.test.ts` — Vitest tests for the 3 acceptance criteria
- Preserve: any pre-existing files in the project (the fixture starts mostly empty; pre-existing `package.json`, `tsconfig.json`, `stack.md` are NOT to be touched).

---

*Conformance test fixture. Used by `planr-pipeline/conformance/runner.mjs`. Do not modify without updating `expected/*.json` accordingly.*
