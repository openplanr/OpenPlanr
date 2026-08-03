<!-- agents/modes/default/designer.md: default-mode-only content for designer-agent. Loaded by agents/designer-agent.md when MODE=default. T-002 of SPEC-002. -->

> **Mode:** default
> **Loaded by:** `agents/designer-agent.md` when the orchestrator passes `MODE=default` (no `SPEC_DIR`).

## Path Resolution

The orchestrator (`/plan`) passes `MODE=default`:

- Read PNGs via the priority order below (UIFiles → `input/ui/feat-{name}/` → `input/ui/*.png`).
- Write `output/feats/feat-${ARGUMENTS}/design-spec.md`.

The 10-section design-spec content is identical in both modes.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| Feature name (`$ARGUMENTS`) | `/planr-pipeline:plan` orchestrator | Yes |
| `input/specs/spec-{feat}.md` | Product Owner | Yes (for `UIFiles:` resolution) |
| Resolved PNGs (see PNG Resolution) | UX Designer | Yes (triggers this agent) |
| `input/tech/stack.md` | Tech Lead | Yes (for component library awareness) |

---

## Outputs

| Output | Path | Description |
|--------|------|-------------|
| Design specification | `output/feats/feat-{name}/design-spec.md` | 10-section design doc |

---

## Path expansion (applies to every PNG path)

Before resolving any PNG path from `UIFiles:`, frontmatter, the orchestrator's brief, or an explicit argument:

- Expand `~/foo` → `$HOME/foo` (read the runtime `$HOME` env var)
- Expand `~user/foo` → `/Users/user/foo` (Mac) or `/home/user/foo` (Linux)
- Resolve bare relative paths against the **project root** (working directory), NOT against `${CLAUDE_PLUGIN_ROOT}`

If a referenced path doesn't exist after expansion, try the unexpanded form as a fallback. If neither resolves, log the expected path and continue with the next priority source — do not error.

## PNG Resolution (default mode — avoids cross-feature collisions)

Resolve PNGs for the target feature `feat-{name}` in this priority order. The first non-empty source wins. Apply path expansion (above) to every candidate path.

1. **Explicit list in spec.** Read `input/specs/spec-{name}.md` and parse the `UIFiles:` YAML block. If present and non-empty, use exactly those paths.
2. **Feature-namespaced folder.** If `input/ui/feat-{name}/` exists and contains `*.png`, use all PNGs there.
3. **Single-feature fallback.** If the project has exactly one feature spec AND `input/ui/*.png` exists at the top level, use those PNGs and log a warning recommending migration to `input/ui/feat-{name}/`.

If all sources are empty: skip silently (do not write design-spec.md, do not error).

If multiple specs share `input/ui/*.png` (collision risk), the orchestrator MUST refuse to invoke designer-agent for any of them and surface an error advising migration to feature-namespaced folders.

---

## Execution Steps

```
0. Receive feature name from /planr-pipeline:plan as $ARGUMENTS (the {name} in feat-{name})
1. Resolve PNGs via the PNG Resolution priority list above
   → If 0 PNGs resolve: skip silently and exit (no design-spec.md written)
2. For each resolved PNG: analyze via Vision — extract colors, layout, components
3. Cross-reference input/tech/stack.md to identify component library in use
4. Compose design-spec.md following the 10-section template (see entry file)
5. Write to output/feats/feat-$ARGUMENTS/design-spec.md
   (creating parent directories as needed)
6. Log: "Designer Agent complete. N PNGs analyzed for feat-$ARGUMENTS. → design-spec.md"
```

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| No PNGs resolve for `feat-{name}` | Skip silently — do not create design-spec.md |
| PNGs in `input/ui/*.png` (top level) but multiple specs exist | Abort — orchestrator refuses; surface migration guidance |
| PNG unreadable / corrupt | Log warning, skip that file, continue |
| Cannot infer color precisely | Use closest approximation, flag in Open Questions |
| No component library detected | Document as "custom / unknown", note in section 4 |

---

*Reads: `input/ui/*.png` · `input/tech/stack.md`*
*Writes: `output/feats/feat-{name}/design-spec.md`*
*Chained to: specification-agent*
