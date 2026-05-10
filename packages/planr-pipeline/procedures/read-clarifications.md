# Procedure: Read Clarifications (invoked by `/plan` before specification-agent dispatch)

> **Purpose:** Detect and parse resolved `clarifications.md` from a prior `/plan` run, then inject the human's answers into the specification-agent's dispatch context so it decomposes without guessing.

## When to invoke

After mode detection and spec-body validation, before dispatching the specification-agent (Step 2 in `plan-steps-2-through-completion.md`).

## Execution

### 1. Locate clarifications file

| Mode | Path |
|---|---|
| Spec-driven | `<SPEC_DIR>/clarifications.md` |
| Default | `output/feats/feat-${SLUG}/clarifications.md` |

If the file does not exist, skip silently and return — no clarifications to process. This is the backward-compatible path.

### 2. Parse resolved answers

Scan the file for `**Resolved:**` lines. For each:
- If the line content after `**Resolved:**` is non-empty and not the template placeholder (`_<PO fills this in...>_`), treat it as resolved
- Extract the parent question (the `## Clarification N: <question>` heading above it)
- Build a list of `{ question: string, resolved: string }` pairs

### 3. Count unresolved

If any `**Resolved:**` lines are empty or contain only the template placeholder, count them. Print:

```
⚠ N unresolved clarification(s) — those areas will remain blocked until resolved.
```

### 4. Inject into specification-agent context

If at least one question is resolved, prepend to the specification-agent's dispatch context:

```markdown
## Resolved Clarifications

The PO resolved these ambiguities from the previous `/plan` run. Use these answers — do NOT re-infer or re-guess these decisions.

- Q: <question> → A: <resolved answer>
- Q: <question> → A: <resolved answer>
```

### 5. Return

The specification-agent receives the resolved answers as part of its input context and uses them during decomposition. Unresolved questions remain blocked — the agent should not attempt to decompose areas covered by unresolved clarifications.
