# OpenPlanr Protocol Conformance Test

> Runtime-agnostic verifier for the `feat-todo` fixture. Run against any adapter (Claude Code, Cursor, Codex) to verify protocol conformance.

## What this verifies

For a given runtime adapter, the conformance test asserts that running PLAN + SHIP against the `feat-todo` fixture produces:

1. **Post-PO state** — valid US + Task files matching `expected/spec-driven-decomposition.json`
2. **Post-DEV state** — `.pipeline-shipped` marker present, build/test green, source written
3. **No Preserve violations** — files in any task's `Preserve:` list are unchanged (`git diff` returns empty for those paths)
4. **Marker schema validity** — the `.pipeline-shipped` YAML validates against the v1.0.0 schema in `protocol/spec-artifacts.md`

## Quick start

```bash
# 1. Copy the fixture into a fresh temp directory
node runner.mjs --runtime claude-code --setup
# Prints: temp dir path. Switch to it.

# 2. Open the dir in your runtime of choice (Claude Code / Cursor / Codex)

# 3. Drive the runtime through the prompts the runner emits
# Runner prints: "Run /openplanr-pipeline:plan todo (Claude Code) OR say 'plan todo' (Cursor/Codex)"

# 4. Once you've completed PLAN, run:
node runner.mjs --runtime claude-code --verify-po --dir <temp-dir>

# 5. Drive SHIP, then:
node runner.mjs --runtime claude-code --verify-ship --dir <temp-dir>
```

The runner exits 0 on pass, non-zero on fail with the failed assertion.

## Why semi-automated?

Full automation would require runtime-specific drivers (Claude Code SDK, Cursor IPC, Codex API). For v1, the test is a **state-checker** — the operator drives the runtime, the runner verifies the produced state. This works equally well for all three runtimes without per-runtime infrastructure.

Full automation per-runtime is a v2 polish item.

## Fixture overview

`feat-todo` — a deliberately tiny fixture:

- 1 functional requirement: "User can add a todo to an in-memory list."
- No PNG → 1 task per US (Tech only).
- Stack: TypeScript + Vitest.
- AC: "Given an empty list, when I add 'buy milk', the list contains exactly one item with text 'buy milk'."

## Files

| File | Purpose |
|---|---|
| `fixture-spec/SPEC-001-todo-feature.md` | The seed spec with full body |
| `fixture-stack/stack.md` | Minimal Node + TypeScript + Vitest stack |
| `expected/spec-driven-decomposition.json` | Post-PO assertions (US + Task file presence + frontmatter) |
| `expected/post-ship-state.json` | Post-DEV assertions (build green, marker present, no Preserve violations) |
| `runner.mjs` | Node script — `--setup`, `--verify-po`, `--verify-ship` flags |

## Anti-checks (red-team)

The runner also performs:

- **Preserve violation check** — `git diff --name-only` against the fixture's pre-PLAN baseline; intersects with any task's `Preserve:` list. Any overlap fails the test.
- **Substitution leak check** — greps for `${CLAUDE_PLUGIN_ROOT}` in generated `.cursor/rules/` and `AGENTS.md`. On Cursor/Codex runtimes, this token must NOT appear (it's Claude-Code-specific).
- **Schema validity** — parses the `.pipeline-shipped` YAML and asserts required fields are present and non-empty.

## Pass criteria summary

A runtime adapter is conformant if:

✅ All three `--verify-*` invocations exit 0
✅ The `.pipeline-shipped` marker `runtime` field correctly identifies the runtime
✅ No Preserve files were mutated
✅ No `${CLAUDE_PLUGIN_ROOT}` tokens leak into Cursor/Codex outputs

## Reporting results

The runner prints a one-line summary to stdout per check, plus a structured JSON report to `conformance-report-<runtime>-<timestamp>.json` in the temp dir. Attach the JSON report to PRs that affect runtime adapters.

---

*OpenPlanr Protocol v1.0.0 conformance test. Compatible with Claude Code, Cursor, and Codex (semi-automated v1).*
