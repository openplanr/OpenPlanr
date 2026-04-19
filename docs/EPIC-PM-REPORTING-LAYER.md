# Stakeholder Reporting & PM Intelligence Layer

> **Status (v1.2.7):** Shipped — see ["What v1 ships"](#what-v1-ships) below.
> **Source PRD:** the long-form vision is preserved in [Original PRD](#original-prd-archived) so the team can see what the layer is *aspiring to* over time. When the two sections disagree, the v1 section wins for users; the PRD is the roadmap.

---

## What v1 ships

This is what is in `openplanr@1.2.7`. Each item is exercised by tests under `tests/` and by the Gherkin scenarios tagged `@v1` in `.planr/stories/US-014-gherkin.feature` … `US-031-gherkin.feature`. Items tagged `@v2` in those files are deliberately deferred and listed under ["Deferred (v2 / future)"](#deferred-v2--future).

### Commands

| Command | What it does |
| --- | --- |
| `planr report <type>` | Generate a stakeholder report from `.planr/` artifacts (+ optional GitHub signals) using Handlebars templates. Types: `sprint`, `weekly`, `executive`, `standup`, `retro`, `release`. |
| `planr report-linter [file]` | Validate a stakeholder markdown file against configurable rules (vague language, evidence density, weekly structure). |
| `planr context` | Emit the report context pack (artifacts, sprint state, GitHub signals, evidence index) as JSON for piping into other tools. |
| `planr voice standup` | Convert a transcript file or stdin into a structured Yesterday / Today / Blockers standup, optionally linted, edited, or appended to a story. |
| `planr story standup --story <ID>` | Append linted standup notes from a transcript onto a user story’s `## Standup notes` section. |

### Output formats and distribution

- **Markdown** (default) and **HTML** (wrapped from the markdown). `--format pdf` exits with an explicit message — PDF rendering is not bundled in this build.
- **Local archive** under `.planr/reports/<type>-<timestamp>.md` (and `.html`).
- **`--push slack`** — POSTs to a Slack [Incoming Webhook](https://api.slack.com/messaging/webhooks) configured at `distribution.slackWebhookUrl`. `--dry-run` works without a webhook (it explains how to enable real delivery).
- **`--push github`** — opens a `planr:report` GitHub issue containing the markdown body (uses the local `gh` CLI). Pre-existing issues with the same title are reused.
- **Email** — `pushReportByEmail` returns a clear "not configured" / "not implemented" message; SMTP is intentionally out of scope for v1.

### Quality gates

- `--lint` (or `planr report-linter`) runs the rules defined in `src/services/report-linter-service.ts`. Defaults cover vague phrasing, evidence density (URLs / `#issue` references), and required sections per report type. Override or extend via `reportLinter` in `.planr/config.json`.
- `--strict-evidence` fails report generation when bullets under `##` headings are not backed by a URL or `#NNN` reference, so claims do not ship without traceability.

### Configuration (`.planr/config.json`)

```json
{
  "reports": {
    "orgName": "Acme",
    "primaryColor": "#0a84ff",
    "logoUrl": "https://example.com/logo.png",
    "templateOverrides": "./reports-overrides",
    "extraSections": [
      { "title": "Compliance", "body": "SOC2 controls verified weekly." }
    ]
  },
  "distribution": {
    "slackWebhookUrl": "https://hooks.slack.com/services/...",
    "slackChannel": "#eng-updates",
    "weeklyRecipientAllowlist": ["alice@example.com"]
  },
  "reportLinter": {
    "rules": [
      { "id": "evidence-density", "enabled": true, "minEvidenceLinks": 1 },
      { "id": "weekly-structure", "enabled": true, "requireSections": ["Wins", "Risks", "Ask"] }
    ],
    "vaguePhrases": [
      { "pattern": "\\balmost done\\b", "alternatives": ["Completed 3 of 5 stories"] }
    ]
  }
}
```

All three blocks are optional. The CLI works without them; the linter ships with sensible defaults.

### Example flows

```bash
# Weekly stakeholder update, written to .planr/reports/, linted before save
planr report weekly --lint

# Sprint summary as HTML, post to Slack (real delivery), keep evidence strict
planr report sprint --sprint SPRINT-001 --format html --strict-evidence --push slack

# Standup from a recorded transcript, with quality gate, written under a story
planr voice standup --file standups/2026-04-19.txt --lint --append-story US-029

# Pipe context into another tool
planr context --report-type weekly --days 7 | jq '.evidence | length'
```

---

## Deferred (v2 / future)

Tracked as `@v2` in the matching Gherkin files; calling them out so contributors don’t mistake them for bugs:

- **PDF rendering** (no headless browser bundled). v1 emits Markdown + HTML and exits cleanly when `--format pdf` is requested.
- **SMTP email delivery** — `pushReportByEmail` is a documented stub with explicit "not implemented" output.
- **Slack OAuth + multi-channel routing** — v1 supports a single Incoming Webhook URL.
- **Native git-tree commit** of report files without an issue — v1 archives locally and optionally opens an issue.
- **Live microphone capture and bundled speech-to-text** — v1 takes transcripts via `--file` or stdin so any STT or OS dictation tool can be paired in.
- **Per-segment audio replay** while editing a transcript — `TranscriptSegment.audioOffsetMs` is reserved in the schema for this.
- **Persistent cross-session coaching history** — the linter currently surfaces hints per run; long-lived per-user history is future work.

---

## Architecture (as built)

| Concern | File |
| --- | --- |
| Type definitions (reports, evidence, linter, voice, distribution) | `src/models/types.ts` |
| Config schema | `src/models/schema.ts` |
| Context assembly (artifacts + GitHub + evidence) | `src/services/context-pack-service.ts` |
| Report generation + Markdown/HTML output | `src/services/report-service.ts` |
| Evidence anchoring + remote checks | `src/services/evidence-service.ts` |
| Quality linter (rules + coaching) | `src/services/report-linter-service.ts` |
| Distribution (Slack webhook, GitHub issue, email stub) | `src/services/distribution-service.ts` |
| Voice transcript parsing | `src/services/standup-parser.ts`, `src/services/voice-service.ts` |
| Append standup notes to a story | `src/services/story-standup-service.ts` |
| Templates | `src/templates/reports/*.md.hbs`, `src/templates/voice/*.md.hbs`, `src/templates/linter/*.json.hbs` |
| CLI surface | `src/cli/commands/{report,report-linter,context,voice,story}.ts` |

Tests of record:

- `tests/report-linter-service.test.ts` — vague-language + structural rules
- `tests/standup-parser.test.ts` — segment + section extraction
- `tests/story-standup-service.test.ts` — appending notes to stories
- `tests/unit/distribution-service.test.ts` — Slack dry-run, real POST, error paths, email stub
- `tests/integration/report-command.test.ts` — `report weekly` happy path, `--stdout`, and `--format pdf` exit code

---

## Original PRD (archived)

The text below is the original product requirements doc. It captures the long-term vision for the reporting layer (multi-tool integrations, voice-first standup with on-device STT, etc.). v1 implements the parts marked above; the rest stays here as the roadmap.

### Problem Statement

Developers hate writing status updates. PMs hate chasing them. Stakeholders receive updates that are technically present but informationally useless — vague summaries like "fixed bugs" with no links, empty risk sections despite being 40% behind on sprint burndown, and no actionable asks.

There is no developer-friendly tool that sits between raw engineering signals (commits, PRs, tickets, sprint data) and the polished, structured narrative that stakeholders actually want to read. Current solutions either live in PM-heavy UIs (Monday, Jira dashboards) that developers avoid, or are generic AI summary tools (ChatGPT) that hallucinate without evidence.

### Solution Overview

Extend OpenPlanr with a **reporting and stakeholder delivery layer** — a CLI-first system that generates structured, evidence-linked reports from existing planning artifacts (`.planr/` hierarchy), GitHub activity (commits, PRs, issues), and sprint data. Reports are linted for quality before delivery, ensuring every claim is backed by traceable evidence.

The system acts as a **"linter for status reports"** — it doesn't just generate updates, it refuses to ship sloppy ones. It coaches developers into producing concise, deliverable-focused reports that stakeholders trust.

### Target Users

1. **Individual developers** — run `planr report` to generate their standup, weekly update, or sprint summary without context-switching into a PM tool
2. **Engineering managers** — get team-level rollups with risk flags automatically surfaced from sprint data
3. **Stakeholders** (via shareable output) — receive polished, evidence-linked reports they can trust without needing CLI access

### Core Features (vision)

1. **Report Generation Engine** — Sprint, Weekly Stakeholder Update, Executive 1-Pager, Standup, Retrospective, Release Notes. *(v1: shipped)*
2. **Evidence-Linked Claims** — every statement traceable to commits, PRs, issues, or planr artifacts. *(v1: shipped via the evidence appendix and `--strict-evidence`; rich hover tooltips deferred)*
3. **Report Quality Linter** — refuses to ship vague language, missing risk sections, or unsupported metrics. *(v1: shipped, configurable; per-user coaching history deferred)*
4. **Context Pack System** — composable context object: `planr context | planr report weekly`. *(v1: shipped)*
5. **Delivery & Distribution** — Markdown, HTML/PDF, GitHub, Slack, Linear/Monday, shareable URL, Email. *(v1: Markdown + HTML, GitHub issue, Slack webhook; PDF / SMTP / Linear / Monday / shareable URL deferred)*
6. **Standup Dictation Mode** — voice → structured update with AI extraction. *(v1: transcript file / stdin → structured markdown; live mic + on-device STT deferred)*

### Success Criteria (target)

- Developer can generate a stakeholder-ready weekly update in under 30 seconds.
- Every claim in a generated report links to at least one evidence source (enforced via `--strict-evidence`).
- Report quality linter catches the bulk of "informationally useless" updates (extensible via project config).
- Reports are indistinguishable from hand-written PM updates in a blind test.
- CLI workflow requires zero context-switching to PM tools.

### Competitive Positioning

This is NOT "AI in a PM tool" — it's a standalone, tool-agnostic, developer-controlled layer that sits above whatever stack the team uses. Linear has AI summaries. GitHub has Copilot. Monday has AI blocks. OpenPlanr's wedge is that it's **the developer's own reporting agent** — controlled from the terminal, backed by evidence, and delivered to stakeholders in their preferred format.
