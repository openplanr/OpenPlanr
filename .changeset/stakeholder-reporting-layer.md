---
"openplanr": patch
---

Add stakeholder reporting & PM intelligence layer

New commands:
- `planr report <type>` — generate `sprint`, `weekly`, `executive`, `standup`, `retro`, or `release` reports from `.planr/` artifacts and (optionally) recent GitHub commits/PRs, written as Markdown + HTML under `.planr/reports/`
- `planr report-linter [file]` — validate stakeholder markdown against configurable rules (vague language, evidence density, required sections per report type) with coaching hints
- `planr context` — emit the report context pack (artifacts + sprint state + GitHub signals + flat evidence index) as JSON for piping
- `planr voice standup` — convert a transcript file or stdin into a structured Yesterday / Today / Blockers standup, with optional `--lint`, `--edit`, `--reload-file`, and `--append-story`
- `planr story standup --story <ID>` — append linted standup notes onto an existing user story

Reporting features:
- `--lint` and `--strict-evidence` quality gates so vague or unsupported claims do not ship
- `--push slack` via [Incoming Webhooks](https://api.slack.com/messaging/webhooks) (`distribution.slackWebhookUrl` in `.planr/config.json`); `--dry-run` works without a webhook configured
- `--push github` archives the report as a `planr:report` GitHub issue via the local `gh` CLI
- Optional org branding and extra sections via the `reports` block in config; optional rule overrides via the `reportLinter` block

Out of scope for this release (deferred):
- Bundled PDF rendering (`--format pdf` exits with a clear "not in this build" message)
- SMTP email delivery (the email path is a documented stub)
- Live microphone capture and bundled speech-to-text — pair `planr voice standup` with any STT or OS dictation tool
- Per-segment audio replay, Slack OAuth / multi-channel routing, native git-tree report commits, persistent cross-session coaching history

See [docs/EPIC-PM-REPORTING-LAYER.md](https://github.com/openplanr/OpenPlanr/blob/main/docs/EPIC-PM-REPORTING-LAYER.md) for the design and shipped-vs-deferred matrix.
