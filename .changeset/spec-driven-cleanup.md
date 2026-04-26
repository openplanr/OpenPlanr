---
"openplanr": patch
---

Spec-driven workflow polish: clearer errors, schema reference, readiness check.

- **Friendlier `planr spec decompose` error** when AI is unavailable — surfaces two actionable paths (configure AI, or hand-author from the schema reference) instead of one terse line.
- **`planr config show` now includes a "Spec-driven readiness" section** — at-a-glance view of whether `planr spec decompose` can run given the current AI config.
- **`planr init --no-ai` prints a warning** listing the AI-dependent commands (`spec decompose`, `refine`, `backlog prioritize`) that will be unavailable, with a one-liner to re-enable later.
- **Canonical schema reference at `docs/reference/spec-schema.md`** — single source of truth for spec / story / task frontmatter, body sections, lifecycle states, and the `.pipeline-shipped` marker. To be hosted at `openplanr.dev/docs/reference/spec-schema`.
- Spec template footnote updated with concrete pipeline / CLI handoff routes.
