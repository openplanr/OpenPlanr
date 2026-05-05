# Procedure: `/plan` — `--dry-run` preview (read-only)

Invoked when `PLAN_DRY_RUN=true` after `${CLAUDE_PLUGIN_ROOT}/commands/procedures/plan-step0-preflight.md` **§ 0.5**, **instead of § 0.6** onward.

Hard rules:

1. Do **NOT** delegate any subagent (no db-agent / designer-agent / specification-agent).
2. Do **NOT** run strategy procedures that mutate disk (`strategy-*.md` **§ execute** hooks). No writes to `.planr/`, no `npm create`, no copied templates — **except** what already happened strictly before § 0.5b (typically nothing when dry-run exits here).
3. Read-only lookups only: same signals used in § 0.4 plus optional directory listings.

## Output payload (print verbatim sections)

### Header

```
/plan — DRY RUN (no subagents, no orchestration writes beyond what already occurred this turn)
```

### Parsed inputs

- `SLUG` / `BRIEF` values after `--dry-run` stripping (already bound upstream).

### Chosen bootstrap strategy

Echo the **`Strategy`** string from § 0.5 row (e.g. `CONTINUE`).

Explain in one bullet what that implies for **Phase B** (MODE binding happens in Step 1 on a real run; here: infer read-only MODE per `${CLAUDE_PLUGIN_ROOT}/commands/procedures/mode-detection.md` **§ Algorithm**, but skip **§ Self-heal**: if spec-driven AND `input/tech/stack.md` is missing — print **`Would self-heal stack.md → input/tech/stack.md (skipped in dry-run)`** instead of writing.)

### Planned PO subagents (hypothetical Step 2)

Mirror `${CLAUDE_PLUGIN_ROOT}/commands/procedures/plan-steps-2-through-completion.md` **§ Step 2** decision logic using **today's disk only**:

| Subagent             | Predicted outcome this run |
|----------------------|----------------------------|
| `db-agent`           | *[run | skipped — cite schema age / DatabaseType / flags]* |
| `designer-agent`     | *[run | skipped — cite resolved PNG globs]* |
| `specification-agent`| *[run | NO-OP — stories already populated | full run]* |

### Footer

```
Dry run complete — remove --dry-run to execute phases B→D normally.
```

---

Stop the command immediately after printing the footer — do **not** advance to `plan-step1-mode-and-spec.md`.
