---
name: planr-artifact
description: Open, share, import, or export an OpenPlanr HTML artifact review. Use when feedback must move between a local artifact and its review board.
license: MIT
---

# Planr Artifact

Use the deterministic `planr artifact` utility when it is installed. Never
relaunch the active coding agent from inside this skill.

1. For local review, run `planr artifact <file>` or
   `planr artifact open <file>`. Use `--no-open --json` in headless sessions.
   Generic artifacts default to the edge-to-edge `document` presentation. Use
   `--presentation canvas` only for an explicitly spatial or zoomable review,
   or `--presentation document` to force the reading surface.
2. Sharing is always explicit. Run `planr artifact share <file>` only after the
   user asks to share. Before sharing or publishing a design document, read
   [design-sharing.md](references/design-sharing.md) and author or refresh its
   sibling `review-context.json` in this active host session. Ground the welcome
   purpose and up to three consequential review questions in that design's brief;
   preserve existing guidance and never invent requirements. Render and inspect
   the updated context before sharing. For a design document this creates a permanent encrypted
   design review with a stable URL and a separately entered generated access
   token. Owner credentials save privately outside the project; copy the reviewer
   token through the studio's Share dialog, never put it in a URL or ordinary
   command output. Publish an explicitly requested update with
   `planr artifact publish <design-document.json>`; synchronize reviewer feedback
   with `planr artifact sync <design-document.json>`. Hosted sharing requires the
   configured compatible service. An unavailable service must be reported, not
   described as a successful share. Generic HTML retains its existing expiring
   live-room and `--snapshot` fragment/short-link behavior; reviewer, owner-verdict,
   and management authority remain separate.
3. For returned feedback, run `planr artifact import <review-url>`. Do not add
   `--allow-stale` by default. Show the stale-review preview and, when the user
   has not already chosen, use the host's native question UI to offer import or
   skip.
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

For explicitly configured company workspaces, read
[company-review.md](references/company-review.md) before selective publication,
company review, or local proposal application. This pre-release route has
separate permissions and storage from encrypted token shares.
