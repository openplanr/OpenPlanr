# Procedure: /design-loop Phase E — approve, taste, handoff (R1 STOP)

> Entered when the board's feedback.json carries `preferred`.

## E.1 — approved.json (schema-validated)

Write `<SESSION_DIR>/approved.json` to `schemas/v1.0.0/design-approved.schema.json`:
`{ schema_version: "1.0.0", boardId, sessionId: "<sessionDir-basename>-<variant>",
approvedVariant, approvedPath: <abs path of the variant's LAST round>, provider, target,
approvedAt, copiedTo: [...E.3], notes: feedback.overall }`. Validate before writing
(`validate()` from `conformance/json-schema-validate.mjs`); the scoped `.gitignore`
deliberately keeps `approved.json` tracked-eligible.

## E.2 — Taste memory: BOTH verdicts (hard rule 11)

- Approved variant:
  `node "$PLUG/lib/design-engine/cli.mjs" taste approved <approvedPath> --project <PROJECT> \
   --session <sessionId> --fonts … --colors … --layouts … --aesthetics …`
  — claude-svg: pass the EXACT attributes you authored (better than vision); openai PNG
  without flags: the engine vision-extracts (needs the key).
- Every OTHER variant that reached the board: `taste rejected <path> …` the same way.
- Surface what changed: "taste: +minimal (0.65→0.76), +mono-mark; playful rejected ×2".

## E.3 — Copy ONLY the approved output into the repo

Exploration stays in user space; the repo receives the approved artifact:

- `target=logo` → `input/design-system/` (default mode) or `.planr/design-system/`
  (spec-driven), as `logo.svg` (claude-svg) or `logo.png` — **plus, for SVG marks, the
  production set**: `logo-mark.svg` (mark only), and a favicon set rendered FROM the mark
  (`favicon.svg` + sizes note; raster favicons only if a rasterizer is available — never
  fake them, say what was emitted).
- `target=screen` for a feature slug → `<SPEC_DIR>/design/` (or `output/feats/feat-<slug>/design/`).
- `target=brand-sheet|og-image` → `input/design-system/` siblings.
- List every copy in `copiedTo` (E.1) and print them.

## E.4 — R1 STOP

Print where everything lives + the natural next commands — and STOP. Never auto-chain and
never publish/share as a side effect of approval; Share remains a separate explicit board or
`planr artifact share` action:

```
✓ design-loop approved: <target> variant <X> (<provider>)
  session   <SESSION_DIR>
  approved  <approvedPath>
  repo      <copiedTo…>
  taste     updated (approved 1, rejected N)
next: /planr-pipeline:design <slug>        (fold into a feature design)
      /planr-pipeline:plan <slug>          (decompose with this brand in place)
```
