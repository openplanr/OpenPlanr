<!-- Loaded by frontend-agent entry; shared across modes. Normative procedure: docs/rules.md § R6 only. -->

## Correction Protocol (frontend DEV)

**Canonical procedure:** **`docs/rules.md`** → **`### R6 — Max 3 Correction Iterations`** — read it before shipping code. Do **not** restate R6 verbatim in prompts or sibling docs.

**After generating files**, run commands from `input/tech/stack.md` in **R6 order**: LintCommand (if set) → TypeCheckCommand (if set) → BuildCommand → TestCommand.

**Iteration‑2 re-read bundle (frontend):** active UI task file · `design-spec.md` when present · `input/tech/stack.md`.

Forbidden shortcuts remain exactly as stated in **R6** (no `--no-verify`, unjustified `@ts-ignore`, bogus `skip()`, etc.).

**Failure handoff:** after **three failed correction passes**, STOP and write the report at the path given in the loaded **`agents/modes/${MODE}/frontend.md`** file (basename **`T-<TASK_ID>-error-report.md`** per task **`id`**), using **`${CLAUDE_PLUGIN_ROOT}/templates/error-report.md`** shape.

---

## Memory writes (mandatory — do these DURING the task, not after)

You MUST write to `.planr/memory.md` when ANY of these conditions apply:

### Trap (on R6 iteration 2+)

When you enter correction iteration 2, **before re-reading the task spec**, append to `## Traps`:

```
- [YYYY-MM-DD, T-<TASK_ID>] <what failed in iteration 1 and the fix>
```

Example: `- [2026-05-11, T-002] Tailwind v4 doesn't support @apply in CSS modules — switched to inline className composition`

### Decision (on any non-obvious architectural choice)

When you make a choice that isn't explicitly specified in the task — a component pattern, a state management decision, a CSS strategy trade-off — append to `## Decisions`:

```
- [YYYY-MM-DD, T-<TASK_ID>] <choice made and why>
```

Examples:
- `- [2026-05-11, T-001] Used useOptimistic over useState for form submissions — smoother UX on slow connections`
- `- [2026-05-11, T-003] Split modal into portal + content components — Next.js App Router hydration errors with inline modals`

### When NOT to write

- Obvious choices that match the stack (e.g., "used React Hook Form because stack.md lists it") — skip
- If `.planr/memory.md` doesn't exist — create it from `${CLAUDE_PLUGIN_ROOT}/templates/memory.md.tpl` first, then append
