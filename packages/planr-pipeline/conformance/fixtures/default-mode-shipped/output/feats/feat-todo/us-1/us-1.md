---
id: "US-001"
title: "Pure addTodo function appends without mutation"
featureSlug: "todo"
slug: "addtodo-pure-append"
schemaVersion: "1.0.0"
status: "pending"
priority: "P1"
created: "2026-05-03"
updated: "2026-05-03"
---

# US-1 — Pure `addTodo` function appends without mutation

> **Feature:** feat-todo
> **Mode:** default
> **Note:** This US-NNN ID is **scoped to the parent feature** (feat-todo), not project-globally unique.

## User Story

**As a** caller of the `addTodo` utility,
**I want to** append a todo string to a list and receive a new array containing the original items plus the new entry,
**so that** I can build up a todo list immutably without mutating the source array.

## Scope

Implements a single pure function `addTodo(list: string[], text: string): string[]` that returns a new array (never mutating its input). The function is exported from `src/todo.ts` and covered by Vitest tests in `tests/todo.test.ts`. No persistence, no UI, no API surface. This is the entirety of `feat-todo`.

## Acceptance Criteria

- [ ] Given an empty list, when `addTodo([], "buy milk")` is called, then it returns `["buy milk"]`.
- [ ] Given a list `["a", "b"]`, when `addTodo(["a", "b"], "c")` is called, then it returns `["a", "b", "c"]`.
- [ ] Given a list `["a", "b"]`, when `addTodo` is called and the result is captured, then the original `["a", "b"]` reference is unchanged (immutability).
- [ ] Given `npx tsc --noEmit` is run, when it completes, then it exits 0.
- [ ] Given `npx vitest run` is run, when it completes, then all tests pass with exit 0.

## Task Breakdown

| Task | File | Agent | Description |
|------|------|-------|-------------|
| T-1 | tasks/task-1.md | backend-agent | Implement `addTodo` in `src/todo.ts` and add Vitest coverage in `tests/todo.test.ts`. |

## Dependencies

- **Depends on:** input/tech/stack.md
- **Blocks:** _none_
- **DB tables involved:** _none_

## Notes

- No PNGs in this US → designer-agent is skipped → exactly 1 task (Type=Tech), per protocol R2.
- Behaviour parity with the spec-driven fixture (`conformance/fixture-spec/SPEC-001-todo-feature.md`): identical function signature, identical 5 acceptance criteria, identical file layout.
