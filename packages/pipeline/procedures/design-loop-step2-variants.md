# Procedure: /design-loop Phase C — variant generation

> The calling session authors every variant against the engine's contract. Substitute
> ABSOLUTE paths into every command (hard rule 6).

## C.1 — Progress file first

Write `<SESSION_DIR>/progress.json`:
`{ "variants": { "A": "queued", … }, "versions": {} }` — the board polls this through the
daemon (file-driven progress, the documented choice). Update it as states change:
`queued → generating → checking → done | failed`.

## C.2 — Author each variant

No subagents needed for authoring — the calling session IS the generator:

1. `… generate --provider claude-svg --variant X …` → returns the **sheet contract** +
   `writeTo` path + instructions.
2. Author each variant SVG yourself per the contract + concept (anti-convergence holds:
   different type family + palette + composition per variant). Write to the `writeTo` path.
3. `… check --file <path> --target <TARGET>` — must pass (one fix round allowed).
4. `… record --variant X --session-dir <…> --file <path> --brief "<concept-X>" --target <TARGET> --project <PROJECT>`.
5. Update `progress.json` per variant.

## C.3 — Collect

- **Failures are stated to the user explicitly** with reasons.
- **Zero successes** → STOP with the collected errors (never fabricate an image).
- ≥1 success → Phase D with the successful set (note the gaps on the board via
  `progress.json` `failed` states).
