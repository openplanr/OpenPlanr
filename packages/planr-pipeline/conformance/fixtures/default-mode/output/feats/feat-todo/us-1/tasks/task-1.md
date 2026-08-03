---
id: "T-001"
title: "Implement addTodo and Vitest coverage"
storyId: "US-001"
featureSlug: "todo"
slug: "implement-addtodo-and-tests"
schemaVersion: "1.0.0"
type: "Tech"
agent: "backend-agent"
status: "pending"
created: "2026-05-03"
updated: "2026-05-03"
---

# T-1 — Implement `addTodo` and Vitest coverage

> **User Story:** US-1
> **Feature:** feat-todo
> **Mode:** default
> **Type:** Tech
> **Agent:** `backend-agent`
> **Note:** Task IDs are **scoped to the parent User Story** (US-1) within feat-todo.

## Objective

Implement a pure `addTodo(list, text)` function in TypeScript and write Vitest coverage that verifies append semantics, immutability, and the build/test gates required by the conformance fixture.

## Files

### Create

- `src/todo.ts` — Exports `addTodo(list: string[], text: string): string[]`. Pure function. Returns `[...list, text]`. No mutation, no side effects.
- `tests/todo.test.ts` — Vitest test file covering the 3 behaviour acceptance criteria (append-to-empty, append-to-existing, immutability).

### Modify

- _none_

### Preserve (do not touch)

- Any pre-existing `package.json` / `tsconfig.json` / project root files. The fixture starts mostly empty; runtime adapters and the conformance harness are responsible for project bootstrap.
- `input/tech/stack.md` — Stack file is read-only configuration; do not edit.
- `output/feats/feat-todo/us-1/us-1.md` — User Story file is owned by the specification-agent; backend-agent must not modify it.

## Technical Spec

1. Read `input/tech/stack.md` to confirm the stack: TypeScript strict, Node 20+, ESM, Vitest.
2. Author `src/todo.ts` exporting `addTodo`. Implementation: `return [...list, text];`. Pure, immutable, no dependencies.
3. Author `tests/todo.test.ts` with three Vitest cases:
   - `addTodo([], "buy milk")` returns `["buy milk"]`.
   - `addTodo(["a", "b"], "c")` returns `["a", "b", "c"]`.
   - The original `["a", "b"]` reference is unchanged after the call (assert via `toBe` on the input identity OR by inspecting the input post-call).
4. Run `BuildCommand` (`npx tsc --noEmit`) — must exit 0.
5. Run `TestCommand` (`npx vitest run`) — must exit 0 with all tests green.

## Test Requirements

- BuildCommand exits 0.
- TestCommand exits 0.
- All 3 behaviour acceptance criteria pass.
- No new production dependencies introduced (Vitest is already in `devDependencies`).

## Definition of Done

- [ ] `src/todo.ts` exists and exports `addTodo`.
- [ ] `tests/todo.test.ts` exists and covers all 3 behaviour acceptance criteria.
- [ ] BuildCommand exits 0.
- [ ] TestCommand exits 0.
- [ ] No files in the Preserve list were modified.
- [ ] No regressions in related features (none exist for this fixture).
