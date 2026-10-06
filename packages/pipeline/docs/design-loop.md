# The Design Loop Engine

> `openplanr-pipeline design-engine` runs the separate SVG exploration loop:
> sessions, a board daemon, feedback files and taste memory. Its board
> adapter uses the artifact runtime, including esbuild and parse5. Standard Design,
> Design Loop and Design Review skills use their packaged Studio utilities; they do
> not share this engine's file-handshake loop.

## Architecture

```
agent (Claude session)                    browser (the user)
  │  node lib/design-engine/cli.mjs …        │
  │  generate/iterate/check/record           │
  ▼                                          ▼
session dir (USER space, ~/.planr/designs/<project>/<target>-<date>/)
  variant-X.svg       session-X.json   progress.json   board.html
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
`GET /health`. The CLI's `board` command auto-starts it (detached) when absent; that daemon
writes its stderr to `daemon.log` in the same directory, and the previous daemon's log is kept
as `daemon.log.1`.

| Route | Method | Purpose |
|---|---|---|
| `/health` | GET | `{ ok, kind, pid, version, boards }`, or `registryError` in place of `boards` when the registry cannot be read |
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

## The provider

`lib/design-engine/providers/` holds one provider, `claude-svg`: the calling agent authors SVG
against the engine's sheet contract, so the engine makes no model calls and needs no key.

| | `claude-svg` |
|---|---|
| Generation | the **agent authors SVG** to a validated sheet contract |
| Iteration | the agent edits the SVG; `record` keeps lineage |
| Quality gate | structural contract validation (`check` on an `.svg`) |
| Cost | $0 beyond the agent's own session |
| Best at | **logos + UI**: exact hex, real type, vector output |

`resolveProvider({ requested })`: `auto` (the default) and `claude-svg` resolve to claude-svg;
any other name is rejected. `taste approved|rejected` on a PNG needs attribute flags
(`--fonts`, `--colors`, `--layouts`, `--aesthetics`).

## Sessions + taste

- `session-<variant>.json` (`design-session.schema.json`): provider, `briefVersions[]`,
  `feedbackHistory[]`, `outputPaths[]` (oldest→newest), `regionEdits[]`.
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
node $PLUG/lib/design-engine/cli.mjs generate \
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
# (in a terminal the daemon `board` spawns survives on its own; inside a sandboxed agent,
#  bring it up first as a background task — `cli.mjs daemon --serve` — then `board` reuses it.)
```

Conformance proof without touching anything: `npm run conformance:design-loop` runs the
entire loop (author → check → record → daemon → pins → consume → iterate → approve →
taste) against a throwaway `PLANR_HOME` — exit 0 means the handshake is intact.
