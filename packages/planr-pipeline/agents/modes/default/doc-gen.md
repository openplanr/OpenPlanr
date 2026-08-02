<!-- agents/modes/default/doc-gen.md: default-mode-only content for doc-gen-agent. Loaded by agents/doc-gen-agent.md when MODE=default. T-002 of SPEC-002. -->

> **Mode:** default
> **Loaded by:** `agents/doc-gen-agent.md` when the orchestrator passes `MODE=default` (no `SPEC_DIR`).

## Path Resolution

The orchestrator (`/ship`) passes `MODE=default`:

- Read US: `output/feats/feat-${ARGUMENTS}/us-*/us-*.md`
- Read tasks: `output/feats/feat-${ARGUMENTS}/us-*/tasks/task-*.md`
- Read QA report: `output/feats/feat-${ARGUMENTS}/qa-report.md`
- Read design-spec (optional): `output/feats/feat-${ARGUMENTS}/design-spec.md`

Output to `Docs/feat-${ARGUMENTS}/` is mode-agnostic.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `output/feats/feat-{name}/us-*/us-*.md` | Specification Agent | Yes |
| `output/feats/feat-{name}/us-*/tasks/task-*.md` | Specification Agent | Yes |
| `output/feats/feat-{name}/qa-report.md` | QA Agent | Yes (must show PASS) |
| Generated source code under `src/` | Frontend/Backend Agents | Yes |
| `output/feats/feat-{name}/design-spec.md` | Designer Agent | If exists |
| `input/tech/stack.md` | Tech Lead | Yes |

---

## Outputs

| Output | Path | Description |
|--------|------|-------------|
| Feature index | `Docs/feat-{name}/README.md` | Overview, US list, links |
| US summary | `Docs/feat-{name}/us-{N}.md` | Per-US plain-language summary + acceptance criteria |
| API reference | `Docs/feat-{name}/api.md` | All endpoints with request/response shapes (from task-2 + actual handlers) |
| Architecture note | `Docs/feat-{name}/architecture.md` | High-level diagram-as-text, file map, key abstractions |

---

## Execution Steps

```
0. Receive feature name from /planr-pipeline:ship as $ARGUMENTS
1. Verify QA gate passed (read output/feats/feat-$ARGUMENTS/qa-report.md → "Verdict: PASS")
   If FAIL: skip silently, log warning
2. Load all us-*.md, task-*.md, qa-report.md, design-spec.md (if present)
3. Walk generated code under src/features/$ARGUMENTS/ and matching frontend paths
4. Cross-reference task-2 endpoints with actual controller code; flag drift
5. Compose Docs/feat-$ARGUMENTS/README.md, us-N.md (one per US), api.md, architecture.md
6. Log: "Doc-Gen Agent complete. M doc files written → Docs/feat-$ARGUMENTS/"
```

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| QA gate FAIL | Skip silently, log: "Doc-Gen skipped — QA gate did not pass" |
| Endpoint described in task-2 not found in code | Document the spec; add note referencing `tasks/T-<id>-error-report.md` when failures exist |
| `Docs/feat-{name}/` already exists with hand-edits | Preserve user-marked sections (look for `<!-- HUMAN -->` markers), regenerate AI sections |

---

*Reads: us-*.md · task-*.md · qa-report.md · design-spec.md · src/ · stack.md*
*Writes: `Docs/feat-{name}/*.md`*
*Gates: QA Agent verdict must be PASS*
