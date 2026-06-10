---
"openplanr": patch
---

`planr status` is now the **whole-project delivery report**. With no argument it rolls up every Spec / Backlog item / Quick Task (or the agile epic→task tree) by status — **done** · **promoted/superseded** (addressed, never counted as done or outstanding) · **outstanding** — cross-referenced with the GitHub issue/PR and Linear identifiers recorded in frontmatter, ending with a Summary and an **Outstanding work** section. New: an optional `[scope]` argument (one spec/epic/feature id or slug), `--md` (paste-ready markdown report), `--json` (machine-readable for agents/CI), and `--github` / `--linear` to live-resolve PR + issue states (offline frontmatter by default). Powered by the new `delivery-status-service` (deterministic aggregation over the existing artifact/GitHub/Linear services); the previous truncated tree view is superseded by the delivery view (`--all` still controls terminal truncation).
