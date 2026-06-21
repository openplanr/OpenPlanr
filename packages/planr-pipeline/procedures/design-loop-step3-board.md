# Procedure: /design-loop Phase D — the board loop

> The BOARD is the chooser; AskUserQuestion is ONLY the blocking wait (hard rule 2).
> Feedback is a FILE the agent reads after the user says done (hard rule 3).

## D.1 — Reveal + serve

> Each variant is also materialized as a real DesignCanvas (`variant-{X}.html` + a copied
> `vendor/`) by `generate`/`record`, so the board shows it on the SAME pannable/zoomable canvas as
> `/design-review` (the board prefers `variant-{X}.html`, degrading to the bare image when absent).
> Nothing extra to run — keep the source `variant-{X}.{svg,png}` on disk for lineage/export.

1. Show the variants inline in chat (Read the PNGs / SVGs) — a quick visual index.
2. Serve the board. The daemon is a long-running server that must OUTLIVE the short-lived
   `board` command — a sandboxed agent runtime reaps a detached child when the launching command
   exits, so bring the daemon up as a tracked **background task** first, then register the board:
   - `node "$PLUG/lib/design-engine/cli.mjs" daemon --status` → if `running:true`, skip the next bullet.
   - else launch as a **background task** and wait for `DAEMON_PORT:`:
     `node "$PLUG/lib/design-engine/cli.mjs" daemon --serve`
   - `node "$PLUG/lib/design-engine/cli.mjs" board --dir <ABS_SESSION_DIR> --id <PROJECT>-<TARGET>`
     → reuses the running daemon (instant); parse the **`BOARD_URL:`** line from stderr. The daemon
     is independent of this session (hard rule 14); if it ever dies, re-run the same `board`
     command — same dir, same feedback files, nothing lost.

## D.2 — The blocking wait

Issue the mandatory `AskUserQuestion` (enforcement per `design-step1-clarify.md`) with the
URL in the question text:

> Your design board is live: **<BOARD_URL>**
> Rate, comment, **pin regions** (click/drag on a variant), remix, or approve there — then
> come back.
> A) **I submitted feedback / approved** — read the board's file
> B) **Regenerate-from-board already requested** — I clicked More-like/Remix/Regenerate
> C) **Cancel the loop**

(A and B both proceed to D.3 — the file disambiguates; the split exists so the user can
say what they did.)

## D.3 — Read the file, never the chat

`readFeedback(<SESSION_DIR>)` via the engine (`lib/design-engine/feedback.mjs` semantics):

- `kind=submit` + `preferred` → **Phase E** (approval).
- `kind=submit` without `preferred` → treat as notes; summarize, ask (D.2) whether to
  iterate with them or approve something.
- `kind=pending` (consumed on read — never double-applied) → D.4 with
  `regenerateAction ∈ iterate | remix | more-like`.
- `null` (no file) → the user hasn't submitted; say so and re-wait (D.2). Do not guess.

## D.4 — Apply a regeneration round

Build the round brief from the feedback: `overall` + per-variant `comments` + **pins**
(quote each pin: `[fix] "thicker strokes" @ (x,y)` — pins are the user pointing at exact
regions; address every `fix`/`improve` pin explicitly, answer `question` pins in chat).

- **iterate** — per session chain, refine don't regenerate:
  openai → `… iterate --variant X --feedback "<round brief>" --session-dir <…>`;
  claude-svg → edit the SVG to satisfy each pin, `… check`, then `… record --feedback …`.
- **more-like** — `preferred` variant becomes the anchor: openai → `iterate` on that
  session asking for N sibling takes (or `evolve --from <its png>`); claude-svg → author N
  new SVGs varying ONLY the non-anchored dimensions.
- **remix** — `remixSpec {layoutFrom, colorsFrom, note}`: openai → `evolve --from <layout
  variant's png>` with a brief importing the other's palette; claude-svg → compose a new
  SVG taking layout geometry from one + palette from the other.

Then: update `progress.json` (`versions` gains each new file per variant — the board's
versions rail + A/B diff feed off it), and
`curl -s -X POST <BOARD_URL>api/reload` → the open tab swaps in place. Loop back to D.2.

Quality gate applies to every regenerated artifact before it reaches the board (rule 10).
