---
"openplanr": minor
---

feat: artifact integrity + rules generator managed-block markers

### Managed-block markers for `rules generate` (fixes AGENTS.md clobber bug)

`planr rules generate --scope pipeline` no longer overwrites the entire AGENTS.md / CLAUDE.md. Generated content is now wrapped in `<!-- ##planr-pipeline:begin## -->` / `<!-- ##planr-pipeline:end## -->` HTML comment markers. On regeneration, only the content between markers is replaced — project headers, agile content, and hand-written sections are preserved. Same treatment for `--scope agile` via `<!-- ##planr-agile:begin## -->` markers.

### Write-time artifact validation

`updateArtifact()` now validates structural invariants before writing: frontmatter fences present, YAML parses, `id:` field unchanged, and checkbox IDs preserved. On violation, throws `ArtifactInvariantError` with the specific violation. This stops AI-driven corruption from `planr refine` / `planr revise` at the door — the file on disk is never poisoned by malformed AI output.

### AI contract: structured deltas for `planr refine`

`planr refine` now asks the AI for structured deltas (`frontmatterChanges` + `bodyChanges`) instead of a whole-file `improvedMarkdown` blob. Our code applies deltas deterministically — the AI never holds a pen on raw bytes. Legacy `improvedMarkdown` responses are validated and rejected if they break structural invariants.

### Migration

- First run of `planr rules generate` on an existing project wraps content in markers automatically (non-destructive).
- `planr refine` change is transparent to users (AI contract is an implementation detail).
- Files previously corrupted by refine must be manually repaired or restored via `git checkout`.
