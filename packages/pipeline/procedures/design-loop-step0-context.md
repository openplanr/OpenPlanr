# Procedure: /design-loop Phase A — context, taste, concepts

> Read by `commands/design-loop.md`. Gathers everything BEFORE the gate. No generation here.

## A.1 — Resolve the engine + workspace

- `PLUG` = plugin root (this file's path minus `/procedures/…`). Engine =
  `node "$PLUG/lib/design-engine/cli.mjs"`. Use the **absolute** form everywhere.
- `PROJECT` = `--project`, else the repo dir name. `TARGET` = first non-flag token
  (`logo` | `brand-sheet` | `screen` | `og-image` | a feature slug → `screen`).
- Run `… doctor --json` → bind `HAS_KEY`, daemon state, and surface every auth warning
  **verbatim** (the cwd-`.env` disclosure and the not-gitignored warning are blocking
  conversations, not log lines — hard rule 7).
- **Artifact placement (hard rule):** exploration lives in USER space —
  `~/.planr/designs/<PROJECT>/<TARGET>-<date>/` (the engine creates it + its scoped
  `.gitignore`). Only APPROVED outputs are copied into the repo in Phase E.

## A.2 — Context gathering (2 rounds max)

Read what exists before asking: the design system (`.planr/design-system/` or
`input/design-system/` — `resolveDesignSystem` semantics from `design-step0-preflight.md`
A.3.5), `brand.md`, the spec for a slug target. Ask AT MOST two rounds of focused
questions (audience, feel, must-keep elements); a clear brief asks zero. Never start a
third round — proceed with what you have and say what you assumed.

## A.3 — Taste read + conflict flagging

```bash
node "$PLUG/lib/design-engine/cli.mjs" taste read --project <PROJECT> \
  --brief --fonts <asked> --colors <asked> --aesthetics <asked>
```

- Show the top effective preferences (decay already applied at read).
- If `conflicts` is non-empty, SHOW each one and ask which side wins **for this run**
  ("you usually prefer minimal; this brief says playful") — never silently resolve
  (hard rule 11). The answer adjusts the concept list, not the stored profile.

## A.4 — Concept list (anti-convergence, verbatim rule 8)

Draft `COUNT` (default 4) one-line concepts. **Each concept must differ in font family +
palette + layout/composition.** Apply the test: *"if you could swap two variants'
headlines unnoticed, one failed — regenerate it"* — at concept stage, that means rewrite
the weaker twin before presenting. Fold in high-confidence taste entries unless the user
overrode them in A.3.

Output of Phase A: `{ PLUG, PROJECT, TARGET, SESSION_DIR, HAS_KEY, concepts[] }` → Phase B.
