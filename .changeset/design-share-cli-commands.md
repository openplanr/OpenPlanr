---
'openplanr': minor
'planr-pipeline': patch
---

You can now manage a shared design from the CLI, the same way the local studio does:

- `openplanr artifact status <design-document>` shows the review link and whether the current revision is published.
- `openplanr artifact manage <design-document> --action ...` rotates the reviewer access token, pauses or resumes comments, revokes or deletes the review, prints the reviewer token, and writes or restores a private recovery file. Rotate, revoke, delete and restore ask first; `--yes` confirms them.
- `openplanr artifact feedback <design-document>` syncs a shared design, then inspects, exports, imports, selects or resolves its feedback.
- `openplanr artifact handoff <design-document> --action ...` now inspects and updates a handoff as well as drafting it. On a shared design, category and disposition changes also reach the review.

If the optional `planr-pipeline` package is missing, these commands say so with `E_DESIGN_SHARE_PIPELINE_MISSING` instead of failing with a generic error.

`design.mjs <command> --help` and `-h` now print help wherever they appear. Before, `design.mjs share --help` ran the share command instead of printing help.
