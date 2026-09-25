# Procedure: /design-loop Phase C — parallel variant generation

> One Task subagent PER VARIANT, each owning its whole lifecycle (hard rule 4). Shell
> variables do NOT reach subagents — substitute ABSOLUTE paths into every prompt
> (hard rule 6).

## C.1 — Progress file first

Write `<SESSION_DIR>/progress.json`:
`{ "variants": { "A": "queued", … }, "versions": {} }` — the board polls this through the
daemon (file-driven progress, the documented choice). Update it as states change:
`queued → generating → checking → done | failed`.

## C.2 — Dispatch (claude-svg provider — the default)

No subagents needed for authoring — the calling session IS the generator:

1. `… generate --provider claude-svg --variant X …` → returns the **sheet contract** +
   `writeTo` path + instructions.
2. Author each variant SVG yourself per the contract + concept (anti-convergence holds:
   different type family + palette + composition per variant). Write to the `writeTo` path.
3. `… check --file <path> --target <TARGET>` — must pass (one fix round allowed).
4. `… record --variant X --session-dir <…> --file <path> --brief "<concept-X>" --target <TARGET> --project <PROJECT>`.
5. Update `progress.json` per variant.

## C.3 — Dispatch (openai provider — only when `PROVIDER=openai`)

Every command below is billed to the user's OpenAI account; `--provider openai` is the
opt-in and must appear on each call (the engine never infers it from a key). Launch `COUNT`
parallel Task subagents (single message, multiple tool calls). Each prompt is self-contained
with absolute paths and owns:

1. `node <ABS_PLUG>/lib/design-engine/cli.mjs generate --provider openai --brief "<concept-X>" \
   --variant X --target <TARGET> --project <PROJECT> --session-dir <ABS_SESSION_DIR>`
   (the engine generates to tmp then cp's — hard rule 5). Defaults: mainline `gpt-5.5`,
   image model `gpt-image-2.5-sunburst`, `--size 1024x1024`, `--quality high`; pass
   `--model` / `--image-model` / `--size` / `--quality` only when the user chose them
   (see `docs/design-loop.md` for the accepted values).
2. On `RATE_LIMITED` (the engine's error code): retry ≤3 with 5s/15s/30s backoff.
3. Quality gate (hard rule 10): `… check --provider openai --file <ABS…>/variant-X.png \
   --brief "<concept-X>"`. On fail → ONE retry: regenerate with the issues appended to the
   brief, re-check.
4. Update `progress.json` (own variant key only) at each transition.
5. Final message: exactly `VARIANT_X_DONE <path>` or `VARIANT_X_FAILED <reason>` or
   `VARIANT_X_RATE_LIMITED` — structured, parseable, never silent.

## C.4 — Collect + fallback

- Parse the structured reports. **Failures are stated to the user explicitly** with reasons.
- **Zero successes → sequential fallback**: state the reason ("all N parallel variants
  failed: <reasons>"), then run the same lifecycle one variant at a time in this session.
  Still zero → STOP with the collected errors (never fabricate an image).
- ≥1 success → Phase D with the successful set (note the gaps on the board via
  `progress.json` `failed` states).
