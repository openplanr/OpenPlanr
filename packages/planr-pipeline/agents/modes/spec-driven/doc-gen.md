<!-- agents/modes/spec-driven/doc-gen.md: spec-driven-mode-only content for doc-gen-agent. Loaded by agents/doc-gen-agent.md when MODE=spec-driven. T-002 of SPEC-002. -->

> **Mode:** spec-driven
> **Loaded by:** `agents/doc-gen-agent.md` when the orchestrator passes `MODE=spec-driven` and `SPEC_DIR`.

## Path Resolution

The orchestrator (`/ship`) passes `MODE=spec-driven` and `SPEC_DIR`:

- Read US: `<SPEC_DIR>/stories/US-*.md`
- Read tasks: `<SPEC_DIR>/tasks/T-*.md`
- Read QA report: `<SPEC_DIR>/qa-report.md`
- Read design-spec (optional): `<SPEC_DIR>/design/design-spec.md`

`<SPEC_DIR> = .planr/specs/SPEC-NNN-${ARGUMENTS}/`. Output to `Docs/feat-${ARGUMENTS}/` is mode-agnostic.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `<SPEC_DIR>/stories/US-*.md` | Specification Agent | Yes |
| `<SPEC_DIR>/tasks/T-*.md` | Specification Agent | Yes |
| `<SPEC_DIR>/qa-report.md` | QA Agent | Yes (must show PASS) |
| Generated source code under `src/` | Frontend/Backend Agents | Yes |
| `<SPEC_DIR>/design/design-spec.md` | Designer Agent | If exists |
| `input/tech/stack.md` | Tech Lead | Yes |

---

## Outputs

| Output | Path | Description |
|--------|------|-------------|
| Feature index | `Docs/feat-{name}/README.md` | Overview, US list, links |
| US summary | `Docs/feat-{name}/us-{slug}.md` | Per-US plain-language summary + acceptance criteria |
| API reference | `Docs/feat-{name}/api.md` | All endpoints with request/response shapes (from Tech tasks + actual handlers) |
| Architecture note | `Docs/feat-{name}/architecture.md` | High-level diagram-as-text, file map, key abstractions |

---

## Execution Steps

```
0. Receive SPEC slug from /planr-pipeline:ship as $ARGUMENTS
1. Verify QA gate passed (read <SPEC_DIR>/qa-report.md → "Verdict: PASS")
   If FAIL: skip silently, log warning
2. Load all <SPEC_DIR>/stories/US-*.md, <SPEC_DIR>/tasks/T-*.md,
   <SPEC_DIR>/qa-report.md, <SPEC_DIR>/design/design-spec.md (if present)
3. Walk generated code under src/features/$ARGUMENTS/ and matching frontend paths
4. Cross-reference Tech-task endpoints with actual controller code; flag drift
5. Compose Docs/feat-$ARGUMENTS/README.md, us-{slug}.md (one per US), api.md, architecture.md
6. Log: "Doc-Gen Agent complete. M doc files written → Docs/feat-$ARGUMENTS/"
```

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| QA gate FAIL | Skip silently, log: "Doc-Gen skipped — QA gate did not pass" |
| Endpoint described in Tech task not found in code | Document the spec; add `"Implementation differs"` note pointing at sibling `tasks/T-<id>-error-report.md` when present |
| `Docs/feat-{name}/` already exists with hand-edits | Preserve user-marked sections (look for `<!-- HUMAN -->` markers), regenerate AI sections |

---

*Reads: `<SPEC_DIR>/stories/US-*.md` · `<SPEC_DIR>/tasks/T-*.md` · `<SPEC_DIR>/qa-report.md` · `<SPEC_DIR>/design/design-spec.md` · src/ · stack.md*
*Writes: `Docs/feat-{name}/*.md`*
*Gates: QA Agent verdict must be PASS*
