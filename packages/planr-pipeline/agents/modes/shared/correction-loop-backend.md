<!-- Loaded by backend-agent entry; shared across modes. Normative procedure: docs/rules.md § R6 only. -->

## Correction Protocol (backend DEV)

**Canonical procedure:** **`docs/rules.md`** → **`### R6 — Max 3 Correction Iterations`** — read it before shipping code. Do **not** restate R6 verbatim in prompts or sibling docs.

**After generating files**, run commands from `input/tech/stack.md` in **R6 order**: LintCommand (if set) → TypeCheckCommand (if set) → BuildCommand → TestCommand (must cover unit **and** integration expectations when both apply).

**Iteration‑2 re-read bundle (backend):** active Tech task file · `output/db/schema.json` when DB work applies · `input/tech/stack.md`.

Forbidden shortcuts remain exactly as stated in **R6**.

**Failure handoff:** after **three failed correction passes**, STOP and write the report at the path given in the loaded **`agents/modes/${MODE}/backend.md`** file (basename **`T-<TASK_ID>-error-report.md`** per task **`id`**), using **`${CLAUDE_PLUGIN_ROOT}/templates/error-report.md`** shape.

---

## Memory writes (mandatory — do these DURING the task, not after)

You MUST write to `.planr/memory.md` when ANY of these conditions apply:

### Trap (on R6 iteration 2+)

When you enter correction iteration 2, **before re-reading the task spec**, append to `## Traps`:

```
- [YYYY-MM-DD, T-<TASK_ID>] <what failed in iteration 1 and the fix>
```

Example: `- [2026-05-11, T-003] vitest can't resolve @/ path alias — must add resolve.alias to vitest.config.ts`

### Decision (on any non-obvious architectural choice)

When you make a choice that isn't explicitly specified in the task — a pattern, a library workaround, an API design trade-off — append to `## Decisions`:

```
- [YYYY-MM-DD, T-<TASK_ID>] <choice made and why>
```

Examples:
- `- [2026-05-11, T-001] Used $transaction loop instead of createMany — Prisma doesn't support nested relations in createMany on PostgreSQL`
- `- [2026-05-11, T-004] Auth middleware registered before catch-all route — Next.js silently shadows routes registered after [...]`

### When NOT to write

- Obvious choices that match the stack (e.g., "used Prisma because stack.md says ORM: Prisma") — skip
- If `.planr/memory.md` doesn't exist — create it from `${CLAUDE_PLUGIN_ROOT}/templates/memory.md.tpl` first, then append
