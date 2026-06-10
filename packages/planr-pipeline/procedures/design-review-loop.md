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
   `<section id>` / `[data-screen]` — that id arrives in `pin.screen`):
   `node "$PLUG/lib/design-engine/cli.mjs" board --dir <ABS_DESIGN_DIR> --id <slug>-review --mode review`
   → parse **`BOARD_URL:`**. (The daemon already serves the artifact's `vendor/` assets
   from the same dir.)
4. Blocking `AskUserQuestion` (enforcement per `design-step1-clarify.md`; URL in the text):
   > Review board live: **<BOARD_URL>** — pin regions on any screen
   > (`fix` / `improve` / `question`), then come back.
   > A) **I submitted pins/feedback** B) **Approve as-is** C) **Cancel**

## B — The pin loop

On feedback (`readFeedback(<DESIGN_DIR>)`; pending consumed on read):

1. **Group pins by `pin.screen`** (fall back to y-position against `finalized.json.screens`
   order when a pin somehow lacks one — say so). Answer every `question` pin in chat.
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
5. Update `<DESIGN_DIR>/progress.json` versions (board rail) +
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
4. Release the lock. **R1 STOP** — print:
   ```
   ✓ design-review: <N> pins addressed across <M> screens · lint 0 errors · iterations=<k>
   next: /planr-pipeline:plan <slug>
   ```
