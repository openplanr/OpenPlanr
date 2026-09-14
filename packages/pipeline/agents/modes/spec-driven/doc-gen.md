<!-- agents/shared/modes/spec-driven/doc-gen.md: spec-driven-mode-only content for doc-gen-agent. Loaded by agents/doc-gen-agent.md when MODE=spec-driven. T-002 of SPEC-002. -->

> **Mode:** spec-driven
> **Loaded by:** `agents/doc-gen-agent.md` when the orchestrator passes `MODE=spec-driven` and `SPEC_DIR`.

## Path Resolution

The orchestrator (`/ship`) passes `MODE=spec-driven` and `SPEC_DIR`:

- Read US: `<SPEC_DIR>/stories/US-*.md`
- Read tasks: `<SPEC_DIR>/tasks/T-*.md`
- Read design-spec (optional): `<SPEC_DIR>/design/design-spec.md`

`<SPEC_DIR> = .planr/specs/SPEC-NNN-${ARGUMENTS}/`. Output to `Docs/feat-${ARGUMENTS}/` is mode-agnostic.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| Explicit request and maintained documentation | User / repository | Primary |
| `<SPEC_DIR>/stories/US-*.md` | Specification Agent | When useful |
| `<SPEC_DIR>/tasks/T-*.md` | Specification Agent | When useful |
| Implemented source and tests | Repository | When documenting behavior |
| `<SPEC_DIR>/design/design-spec.md` | Designer Agent | When relevant |
| `input/tech/stack.md` | Tech Lead | When relevant |

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
1. Read the request, existing maintained docs, relevant specification/design
   context, and the implemented source and tests that establish behavior.
2. Identify the documentation surfaces materially affected by the change.
3. Update those surfaces using the repository's current structure, or the default
   `Docs/feat-$ARGUMENTS/` shapes when no stronger convention exists.
4. Verify relevant links, commands, examples, API shapes, and code references.
5. Return the changed paths, checks, and any material intent/implementation drift.
```

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| Planning artifact missing | Use the request, source, tests, and maintained docs; state any material assumption |
| Endpoint described in planning is not found in code | Document observed behavior and flag the discrepancy clearly |
| `Docs/feat-{name}/` already exists with hand-edits | Preserve user-marked sections (look for `<!-- HUMAN -->` markers), regenerate AI sections |

---

*Reads: request · maintained docs · relevant spec/design context · source · tests · stack context*
*Writes: `Docs/feat-{name}/*.md`*
