# Procedure: Memory Read + Initialize (invoked by `/ship` Step 1.9 and `/plan` Step 0)

> **Purpose:** Ensure `.planr/memory.md` exists, read it, keyword-match entries against the current task, and inject relevant entries into the agent's dispatch context.

## When to invoke

- **`/ship`:** after `MODE`, `SPEC_DIR`/`FEAT_DIR`, and `DISPATCH_MODE` are bound (Step 1.8), before any task dispatch (Step 2).
- **`/plan`:** after mode detection (Step 1), before subagent dispatch (Step 2).

## Execution

### 1. Ensure memory file exists

Check for `.planr/memory.md` at the project root. **If absent, create it from `${CLAUDE_PLUGIN_ROOT}/templates/memory.md.tpl`.** This is not optional — the file must exist so agents can append to it during the run. Print: `✓ Created .planr/memory.md`. If the file already exists, continue silently.

### 2. Pruning warning

If the file exceeds **200 lines** (excluding blank lines and section headers), print:

```
⚠ memory.md has N entries — consider pruning stale entries.
```

### 3. Extract keywords from the current task

For each task about to be dispatched, build a keyword set from:

- File paths in the task's `Create:` and `Modify:` lists (extract filenames, directory names, and extensions)
- Framework/ORM/tool names from `input/tech/stack.md` (`Framework`, `ORM`, `TestFramework`, `Language`)
- The task's `title` field (split into words, drop stop words)

### 4. Match memory entries

Scan all entries across all three sections (`## Decisions`, `## Traps`, `## Corrections`). An entry matches if **any** keyword appears in the entry text (case-insensitive substring match).

### 5. Inject into dispatch context

If matches are found, prepend a `## Relevant Project Memory` section to the agent's dispatch context:

```markdown
## Relevant Project Memory

The following entries from `.planr/memory.md` are relevant to this task. Read them before starting — they capture decisions, failure traps, and human corrections from prior runs.

### Traps (avoid these failures)
- [2026-05-10, T-003] vitest + tsconfig paths in monorepo: must set resolve.alias in vitest.config.ts

### Decisions (honor these choices)
- [2026-05-09, T-001] Prisma createMany doesn't support nested relations on PG — use $transaction

### Corrections (human overrides — do not re-infer)
- [2026-05-08, designer] PNG shows 12-col grid but confirmed 8-col in Figma
```

Omit sections with zero matches. If no entries match at all, omit the entire section (don't inject an empty block).

## Memory write hooks (invoked during Step 2c, not here)

This procedure is read-only. The write hooks are in the correction-loop files:

- **Trap append (R6 iteration 2+):** when entering iteration 2, the correction loop appends a trap entry: `- [YYYY-MM-DD, T-NNN] <what failed and the fix approach>`
- **Correction append (R1 override):** when the human modifies agent output at the R1 review gate, the orchestrator appends: `- [YYYY-MM-DD, <agent>] <what was overridden and why>`
- **Decision append (opt-in):** agents may append decisions during `/ship` when they make an architectural choice not in the task spec: `- [YYYY-MM-DD, T-NNN] <choice made and why>`

All appends create the file from `templates/memory.md.tpl` if absent.
