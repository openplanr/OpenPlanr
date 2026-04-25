---
"openplanr": patch
---

Fix `planr spec shape` UX — replace `$EDITOR`-opening prompts with single-line prompts.

Previously, `planr spec shape <SPEC-id>` opened `$EDITOR` (vim by default for many users) for the Context, Business Rules, and Decomposition Notes questions. This was hostile UX — users unfamiliar with vim couldn't navigate, and a single accidental Enter on an empty buffer aborted the entire interactive flow.

**v1.4.1 changes:**

- **Question 1 (Context)** is now three single-line prompts: primary user, problem solved, expected outcome. Each is optional; provide what you can. The shape skill composes the Context section from your answers using markdown subheadings.
- **Question 3 (Business Rules)** is now a single line. Hint guides the user to edit the spec markdown file directly for longer-form rules.
- **Optional Decomposition Notes** is now a single line. Same guidance — edit file directly for longer prose.
- Functional Requirements (Q2) and Acceptance Criteria (Q4) are unchanged — they were already comma-separated lists.

Net effect: the entire shape flow now runs in the terminal with single-line prompts only. No `$EDITOR` open. No accidentally-empty-buffer aborts.

For users who genuinely want long-form prose, the recommended path is: run `planr spec shape` for quick capture, then edit `.planr/specs/SPEC-NNN-{slug}/SPEC-NNN-{slug}.md` directly in your editor of choice afterward.

Origin: surfaced by real-world testing where a user pressed Enter past the vim buffer without writing anything and lost the entire shape flow.
