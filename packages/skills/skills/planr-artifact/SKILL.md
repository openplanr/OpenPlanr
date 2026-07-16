---
name: planr-artifact
description: Open, share, import, or export an OpenPlanr HTML artifact review using the public planr CLI.
license: MIT
---

# Planr Artifact

Use only the public `planr artifact` command. Never invoke `planr-pipeline`
directly and never relaunch the active coding agent from inside this skill.

1. For local review, run `planr artifact <file>` or
   `planr artifact open <file>`. Use `--no-open --json` in headless sessions.
   Generic artifacts default to the edge-to-edge `document` presentation. Use
   `--presentation canvas` only for an explicitly spatial or zoomable review,
   or `--presentation document` to force the reading surface.
2. Sharing is always explicit. Run `planr artifact share <file>` only after the
   user asks to share. It creates a stable encrypted live room by default:
   anyone with the review URL can comment, and only the separate creator manage
   URL can pause comments, set the final verdict, or delete the room. Explain
   that `--snapshot` selects the immutable fragment/short-link alternative.
3. For returned feedback, run `planr artifact import <review-url>`. Do not add
   `--allow-stale` without showing the stale-review preview and obtaining the
   user's explicit approval.
4. Export a completed local session with
   `planr artifact export <session-id> --format json|markdown`.
5. If the pipeline package is unavailable, report the exact corrective command
   printed by `planr`; do not bypass the runtime lock or managed state.

Local review is loopback-only. Opening, approving, finishing, or importing an
artifact never publishes it automatically.

The CLI bundles complete local HTML/CSS/JavaScript before review or sharing and
runs it inside an invisible opaque-origin sandbox. This is private review, not
standalone website hosting; never describe a review URL as deploying the source
artifact.
