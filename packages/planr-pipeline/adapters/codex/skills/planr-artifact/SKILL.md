---
name: planr-artifact
description: Open, share, import, or export an OpenPlanr HTML artifact review using the public planr CLI.
---

# Planr Artifact

Use only the public `planr artifact` command. Never invoke `planr-pipeline`
directly and never relaunch Codex from inside this skill.

1. For local review, run `planr artifact <file>` or
   `planr artifact open <file>`. Use `--no-open --json` in headless sessions.
   Generic artifacts default to the headless `document` presentation. Use
   `--presentation canvas` only when the user requests spatial/zoomable review;
   use `--presentation document` to force the reading surface.
2. Sharing is always explicit. Run `planr artifact share <file>` only after the
   user asks to share. Explain that fragment links contain encoded plaintext;
   encrypted short links store ciphertext and keep the key in the URL fragment.
3. For returned feedback, run `planr artifact import <review-url>`. Do not add
   `--allow-stale` without showing the stale-review preview and obtaining the
   user's explicit approval.
4. Export a completed local session with
   `planr artifact export <session-id> --format json|markdown`.
5. If the pipeline package is unavailable, report the exact corrective command
   printed by `planr`; do not bypass the runtime lock or managed state.

Local review is loopback-only. Opening, approving, finishing, or importing an
artifact never publishes it automatically.

Artifact review bundles complete local HTML/CSS/JavaScript and presents it
inside an invisible opaque-origin sandbox. It is private review, not standalone
website hosting; never describe a share link as deploying the artifact itself.
