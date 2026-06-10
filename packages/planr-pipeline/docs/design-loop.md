# The Design Loop Engine

> `/planr-pipeline:design-loop` (exploration for any target) and
> `/planr-pipeline:design-review` (pin-review of an existing artifact) share one engine:
> `lib/design-engine/` — providers, sessions, a board daemon, a file-handshake feedback
> protocol, and taste memory. Zero npm dependencies; everything is plain Node ESM.

## Architecture

```
agent (Claude session)                    browser (the user)
  │  node lib/design-engine/cli.mjs …        │
  │  generate/iterate/check/record           │
  ▼                                          ▼
session dir (USER space, ~/.planr/designs/<project>/<target>-<date>/)
  variant-X.png|svg   session-X.json   progress.json   board.html
  feedback.json       feedback-pending.json            approved.json
  ▲                                          ▲
  │            board daemon (localhost)      │
  └── reads files ◄── serves + writes ◄──────┘
```

The agent and the browser never talk directly — **files in the session dir are the
protocol**. That keeps the agent side dumb, reliable, and crash-safe (either side can die
and the other keeps working — re-run `board` on the same dir and nothing is lost).

## The daemon protocol

`lib/design-engine/daemon.mjs` — a persistent localhost HTTP server. State lives in
`~/.planr/design-daemon/` (`port` + `boards.json`). Discovery: read the port file, confirm
`GET /health`. The CLI's `board` command auto-starts it (detached) when absent.

| Route | Method | Purpose |
|---|---|---|
| `/health` | GET | `{ ok, pid, boards }` |
| `/` | GET | board index |
| `/api/boards` | POST | register `{ id, dir }` (dir must contain `board.html`) |
| `/boards/<id>/` | GET | the board HTML |
| `/boards/<id>/<file>` | GET | static asset from the board dir (realpath-guarded) |
| `/boards/<id>/api/progress` | GET | `progress.json` + `reloadGen` |
| `/boards/<id>/api/feedback` | POST | `{ kind: submit\|pending, feedback }` → writes the file (schema-validated, pins clamped) |
| `/boards/<id>/api/reload` | POST | bump `reloadGen` — the open tab polls it and swaps in place |

**Progress is a file** (deliberate): the agent writes `progress.json`
(`{ variants: { A: queued|generating|checking|done|failed }, versions: { A: [files…] } }`)
next to `board.html`; the daemon only reads it. A per-board mutex serializes
feedback-writes vs reload-bumps.

## The feedback handshake

The board writes **files next to `board.html`** — the agent reads them only after the user
returns to chat (AskUserQuestion is the blocking wait; **the board is the chooser**):

- `feedback.json` — Submit/Approve. Left in place.
- `feedback-pending.json` — Regenerate / Remix / More-like-this. **Consumed (deleted) on
  read** so a round can never be double-applied.

Shape (`schemas/v1.0.0/design-feedback.schema.json`):

```json
{
  "schema_version": "1.0.0",
  "boardId": "wpsyde-logo", "publishedAt": "2026-06-10T12:00:00Z",
  "preferred": "B",
  "ratings": { "A": 3, "B": 5 }, "comments": { "A": "too corporate" },
  "overall": "lean into B, darker indigo",
  "regenerated": false, "regenerateAction": "iterate|remix|more-like",
  "remixSpec": { "layoutFrom": "A", "colorsFrom": "B" },
  "pins": [{ "variant": "B", "x": 0.42, "y": 0.1, "w": 0.2, "h": 0.08,
             "comment": "kern the wordmark tighter", "intent": "fix", "screen": "s-hero" }]
}
```

**Pins** are the core of "fix exactly this": normalized 0..1 regions (click = point,
drag = box). In review mode each pin auto-maps to the nearest `<section id>` /
`[data-screen]` of the artifact, so the agent regenerates only that screen.

## The provider interface

`lib/design-engine/providers/` — one shape per provider:
`generateVariant(brief, opts) → { imagePath(tmp), responseId }`,
`iterate(session, feedback, opts)`, `checkQuality(artifact, brief, opts) → { pass, issues }`.

| | `openai` | `claude-svg` |
|---|---|---|
| Needs | API key (`setup`) | nothing — always available |
| Generation | Responses API: `gpt-4o` + `image_generation` (gpt-image-2) | the **agent authors SVG** to a validated sheet contract |
| Iteration | `previous_response_id` chain — refines, never regenerates | the agent edits the SVG; `record` keeps lineage |
| Quality gate | gpt-4o vision vs brief | structural contract validation ($0) |
| Best at | photographic/moodboard, og-images | **logos + UI**: exact hex, real type, vector output |

`resolveProvider({ requested, auth })`: `auto` → openai when a key resolves, else
claude-svg (a first-class fallback, not an apology). Requesting `openai` without a key
errors with **both** repairs.

Auth order: `~/.planr/credentials.json` → `OPENAI_API_KEY` env (with the **silent-billing
disclosure** when that key also sits in the cwd's `.env`, + a warning if that `.env` isn't
gitignored) → none. Keys are never echoed anywhere.

## Sessions + taste

- `session-<variant>.json` (`design-session.schema.json`): provider, `briefVersions[]`,
  `feedbackHistory[]`, `outputPaths[]` (oldest→newest), `regionEdits[]`, `lastResponseId`.
- `taste-profile.json` (`taste-profile.schema.json`): per-project; dimensions
  fonts/colors/layouts/aesthetics, entries `{value, confidence, approved_count,
  rejected_count, last_seen}`. Updated on **both** approve and reject; **5%/week decay is
  computed at read time** (raw values persist); profile↔brief conflicts are flagged to the
  user, never silently resolved.

## 5-minute demo (no key, $0)

```bash
PLUG=~/.claude/plugins/…/planr-pipeline        # or the repo checkout
node $PLUG/lib/design-engine/cli.mjs doctor    # expect: dryRun.pass=true, cost $0

# 1. ask for the authoring contract
node $PLUG/lib/design-engine/cli.mjs generate --provider claude-svg \
  --brief "geometric W mark, indigo on cream" --target logo --project demo --variant A
# → prints the sheet contract + the exact writeTo path

# 2. author variant-A.svg at that path (the agent's job), then gate + record it
node $PLUG/lib/design-engine/cli.mjs check  --file <writeTo> --target logo   # pass:true
node $PLUG/lib/design-engine/cli.mjs record --variant A --session-dir <dir> \
  --file <writeTo> --brief "geometric W mark" --target logo --project demo

# 3. board it
node $PLUG/lib/design-engine/cli.mjs board --dir <dir> --id demo-logo
# → stderr: BOARD_URL: http://127.0.0.1:<port>/boards/demo-logo/
# open it: pin a region, rate, Submit → feedback.json appears next to board.html

# with a key instead: node $PLUG/lib/design-engine/cli.mjs setup
# → stores the key (0600) + runs a real smoke generation and prints the proof:
#   { outputPath, sessionFile, responseId, elapsed, bytes } + "Smoke test PASSED"
```

Conformance proof without touching anything: `npm run conformance:design-loop` runs the
entire loop (author → check → record → daemon → pins → consume → iterate → approve →
taste) against a throwaway `PLANR_HOME` — exit 0 means the handshake is intact.
