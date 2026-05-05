<!-- agents/modes/spec-driven/designer.md: spec-driven-mode-only content for designer-agent. Loaded by agents/designer-agent.md when MODE=spec-driven. T-002 of SPEC-002. -->

> **Mode:** spec-driven
> **Loaded by:** `agents/designer-agent.md` when the orchestrator passes `MODE=spec-driven` and `SPEC_DIR`.

## Path Resolution

The orchestrator (`/plan`) passes `MODE=spec-driven` and `SPEC_DIR`:

- Read PNGs from `<SPEC_DIR>/design/*.png` (the user attached them via `planr spec attach-design`).
- Write `<SPEC_DIR>/design/design-spec.md` (same `design/` subfolder).

`<SPEC_DIR> = .planr/specs/SPEC-NNN-${ARGUMENTS}/`. The 10-section design-spec content is identical in both modes.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| Feature/spec slug (`$ARGUMENTS`) | `/planr-pipeline:plan` orchestrator | Yes |
| `<SPEC_DIR>/SPEC-NNN-{slug}.md` (for `UIFiles:` resolution) | Product Owner | Yes |
| Resolved PNGs from `<SPEC_DIR>/design/*.png` | UX Designer | Yes (triggers this agent) |
| `input/tech/stack.md` | Tech Lead | Yes (for component library awareness) |

---

## Outputs

| Output | Path | Description |
|--------|------|-------------|
| Design specification | `<SPEC_DIR>/design/design-spec.md` | 10-section design doc |

---

## Path expansion (applies to every PNG path)

Before resolving any PNG path from `UIFiles:`, frontmatter, the orchestrator's brief, or an explicit argument:

- Expand `~/foo` → `$HOME/foo` (read the runtime `$HOME` env var)
- Expand `~user/foo` → `/Users/user/foo` (Mac) or `/home/user/foo` (Linux)
- Resolve bare relative paths against the **project root** (working directory), NOT against `${CLAUDE_PLUGIN_ROOT}`

If a referenced path doesn't exist after expansion, try the unexpanded form as a fallback. If neither resolves, log the expected path and continue with the next priority source — do not error.

## PNG Resolution (spec-driven mode)

In spec-driven mode the canonical PNG location is `<SPEC_DIR>/design/*.png`. The user attaches PNGs via `planr spec attach-design`. If `<SPEC_DIR>/design/` is empty, the agent falls back through this priority order: `UIFiles:` block in the spec frontmatter, then `input/ui/feat-{slug}/`, then top-level `input/ui/*.png` under the single-feature exception.

If all sources are empty: skip silently (do not write design-spec.md, do not error).

---

## Execution Steps

```
0. Receive spec slug from /planr-pipeline:plan as $ARGUMENTS (the {slug} in SPEC-NNN-{slug})
1. Resolve PNGs via the priority list (start at <SPEC_DIR>/design/*.png)
   → If 0 PNGs resolve: skip silently and exit (no design-spec.md written)
2. For each resolved PNG: analyze via Vision — extract colors, layout, components
3. Cross-reference input/tech/stack.md to identify component library in use
4. Compose design-spec.md following the 10-section template (see entry file)
5. Write to <SPEC_DIR>/design/design-spec.md
   (creating parent directories as needed)
6. Log: "Designer Agent complete. N PNGs analyzed for SPEC-NNN-$ARGUMENTS. → design/design-spec.md"
```

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| No PNGs resolve for the spec | Skip silently — do not create design-spec.md |
| PNG unreadable / corrupt | Log warning, skip that file, continue |
| Cannot infer color precisely | Use closest approximation, flag in Open Questions |
| No component library detected | Document as "custom / unknown", note in section 4 |

---

*Reads: `<SPEC_DIR>/design/*.png` · `input/tech/stack.md`*
*Writes: `<SPEC_DIR>/design/design-spec.md`*
*Chained to: specification-agent*
