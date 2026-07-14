# Procedure: /design-review — pin loop on an existing design artifact

> Read by `commands/design-review.md`. The artifact is the one `/planr-pipeline:design`
> already produced; this loop EDITS it screen-by-screen from board pins.

## A — Locate + serve

1. `mode-detection.md` with `${SLUG}` → `DESIGN_DIR` (`<SPEC_DIR>/design/` spec-driven,
   `output/feats/feat-${SLUG}/design/` default). Artifact = `finalized.html` or
   `canvas.html` (else two-line fatal: run `/planr-pipeline:design ${SLUG}` first).
   Read `finalized.json` → bind `design_format`, `iterations`, `screens`.
2. Acquire the same advisory lock `/design` uses (`<DESIGN_DIR>/.design.lock`,
   `design-step0-preflight.md` A.4 semantics) — a review IS a design mutation session.
   Release on every exit path.
3. Serve in **review mode** (one iframe + pin layer; pins auto-map to the nearest
   `<section id>` / `[data-screen]` — that id arrives in `pin.screen`). The board daemon is a
   long-running server that must OUTLIVE the short-lived `board` command — a sandboxed agent
   runtime reaps a detached child when the launching command exits, so bring the daemon up as a
   tracked **background task** first, then register the board against it:
   - `node "$PLUG/lib/design-engine/cli.mjs" daemon --status` → if `running:true`, skip the next bullet.
   - else launch as a **background task** and wait for `DAEMON_PORT:`:
     `node "$PLUG/lib/design-engine/cli.mjs" daemon --serve`
   - `node "$PLUG/lib/design-engine/cli.mjs" board --dir <ABS_DESIGN_DIR> --id <slug>-review --mode review`
     → reuses the running daemon (instant, no spawn); parse **`BOARD_URL:`**. (The daemon serves
     the artifact's `vendor/` assets from the same dir.)
   - **Share is optional and explicit.** The board's Share control (or an explicit
     `planr artifact share <ABS artifact>`) creates an immutable review link. Starting the
     board, pinning, reloading, regenerating, or approving never uploads/publishes automatically.
4. Blocking `AskUserQuestion` (enforcement per `design-step1-clarify.md`; URL in the text):
   > Review board live: **<BOARD_URL>** — pin regions on any screen
   > (`fix` / `improve` / `question`), then come back.
   > A) **I submitted pins/feedback** B) **Approve as-is** C) **Cancel**

   If a remote reviewer returns a review URL, explicitly run
   `planr artifact import "<returned-review-url>"` before choosing A. Import merges through the
   adjacent feedback lifecycle; pasting the URL into chat is not feedback and does not approve,
   regenerate, publish, or advance the workflow.

## B — The pin loop

On feedback (`readFeedback(<DESIGN_DIR>)`; pending consumed on read):

An imported remote review reaches this same read only after the explicit import has validated
the artifact digest and translated it into the adjacent design feedback. It must not replace or
drop existing ratings, comments, replies, resolution state, or regeneration fields.

1. **Group pins by `pin.screen`** (fall back to y-position against `finalized.json.screens`
   order when a pin somehow lacks one — say so). Answer every `question` pin in chat — note each
   question pin id you answered, for the resolve step below.
2. Per pinned screen, regenerate **only that screen's markup section**:
   - Locate `<section class="screen" id="<pin.screen>">` (walkthrough), the artboard entry
     (canvas `DATA`), or the `GENERATOR:screen` region (prototype).
   - **claude-svg path (default, $0):** edit the actual HTML of that section to satisfy each
     `fix`/`improve` pin — through the design system's tokens (`var(--…)`), the craft rubric,
     and `design-principles.md`. This is surgical: untouched screens stay byte-identical.
   - **openai path (only for moodboard-level "make it feel like…" pins, key present):**
     `… evolve --from <screenshot-of-screen>` to produce a reference image, then STILL apply
     the change as HTML edits (the artifact stays the source of truth — never replace markup
     with a bitmap).
3. **Lint gate (mandatory, the same C.4.5a bar):**
   `node "$PLUG/lib/design/lint.mjs" <ABS artifact>` → **0 errors required**
   (spacing-off-grid, contrast-below-aa, frame checks). Fix every error before reloading;
   treat token/font warnings as the worklist they are.
4. Record lineage: `… record --variant artifact --session-dir <DESIGN_DIR> --file <artifact>
   --brief "review round" --feedback "<pin summary>"` + append the pins to the session's
   `regionEdits` (engine `recordRegionEdit` shape).
5. **Mark the pins you addressed resolved** (a team action — runs against the live board). Collect
   the ids of every pin handled this round: each `fix`/`improve` pin whose screen passed the lint
   gate (step 3), plus each `question` pin you answered in chat (step 1). Flip them in the durable
   record AND live on the board in one call:
   `node "$PLUG/lib/design-engine/cli.mjs" feedback resolve --dir <ABS_DESIGN_DIR> --id <slug>-review --pins <id,id,…>`
   - Pass the SAME `--id <slug>-review` slug you served the board with (A.3) — the resolve call
     re-derives the board's capability id from it.
   - Only resolve pins you actually addressed; leave a pin `open` if its lint errors weren't all
     cleared, or if you deferred it. The daemon merges under its per-board lock and broadcasts the
     change, so any open review tab flips the marker ring + rail chip to resolved without a reload.
     `missing` ids in the output mean the reviewer deleted that pin mid-round — a safe no-op.
6. Update `<DESIGN_DIR>/progress.json` versions (board rail) +
   `curl -s -X POST <BOARD_URL>api/reload` → the tab swaps in place. Back to the A.4 wait.

## C — Approve + sync the PO artifacts (R1)

When feedback carries `preferred` (or the user picked "Approve as-is"):

1. **`finalized.json`**: `iterations += 1` (one bump per review session), refresh
   `generated_at`; re-validate with `lib/design/manifest.mjs validateManifest` before write.
2. **`design-spec.md` sync**: update ONLY the sections the pins changed — colors touched →
   §1 Color Palette; component shape/size changes → §4 Components / §8 Overrides; screens
   added/renamed → §9 Screen Inventory. Note at the changed lines: `(revised in design
   review <date>)`. Never rewrite untouched sections.
3. **Manifest record**: append one line to `<feature>/.run-manifest.jsonl` (create if the
   feature has one already; else skip silently):
   `{ "stage": "design.review", "agent": null, "started_at": …, "ended_at": …,
      "files_written": [artifact, "design-spec.md", "finalized.json"],
      "exit_status": "success", "pins_addressed": N }`.
4. Release the lock. Approval does not share or publish the artifact. **R1 STOP** — print:
   ```
   ✓ design-review: <N> pins addressed across <M> screens · lint 0 errors · iterations=<k>
   next: /planr-pipeline:plan <slug>
   ```
