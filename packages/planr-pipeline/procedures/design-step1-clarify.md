# Procedure: /design Step B — clarify source + format

> Read by `commands/design.md` Step B. Interactive by default; fully skipped when both
> `--format` and `--from` are supplied (CI/headless path).

## B.0 — Flag short-circuit (CI/headless)

If `FORMAT` **and** `FROM` are both set from flags: bind `{ source: FROM, format: FORMAT }`
and return immediately — do NOT call `AskUserQuestion`. This is the canonical headless
invocation, e.g. `/planr-pipeline:design auth-flow --from spec --format walkthrough --yes`.

If exactly one of the two is set, ask only for the missing axis (below).

## B.0.5 — Thin-spec clarification (only when `THIN_SPEC`, v0.13.1)

When preflight set `THIN_SPEC = true` (0 screens resolved, interactive run — see
`design-step0-preflight.md` A.3 / `decideThinSpec`), the structural resolver found no
`## Screens` list or `ui_files:`. **Do not abort and do not invent screens** — ask how to
source them via `AskUserQuestion`:

> **<slug>** looks UI-facing but has no structural screen list. How should I get the screens?
> A) **Derive from the spec** — read the spec's functional requirements / flows and infer the screen list *(recommended when the spec is rich)*
> B) **Use `<DESIGN_DOC>`** — ground the screens in an existing design doc I found *(shown only if `DESIGN_DOCS` is non-empty, e.g. `design/ux-flows.md`)*
> C) **I'll add a `## Screens` section** — cancel; I'll structure the spec and re-run
> D) **Cancel**

- **A (derive)** → set `source = describe`-equivalent and `content_provenance = inferred`.
  Read the spec body, infer the realistic screen list from its requirements/flows, and use
  that as `SCREENS` for the rest of the run. Generate only screens grounded in the spec —
  never wholesale invention (SPEC-015 F8).
- **B (design doc)** → read the chosen `DESIGN_DOC`, derive `SCREENS` from it, set
  `content_provenance = spec` (the doc is authored intent, not inferred). Then continue.
- **C / D** → release the `.design.lock` (acquired in A.4) and **STOP** cleanly (no fatal,
  no partial output). For C, print the one-line next step: add a `## Screens` list (or
  populate `ui_files:`), then re-run `/planr-pipeline:design <slug>`.

After A or B, `SCREEN_COUNT` is now > 0 — proceed to B.1 → B.3 normally (the format
recommendation in B.3 uses the resolved count). With `--yes` and no other signal, assume
**A (derive from the spec)**.

## B.1 — Evolve vs replace (only when `HAS_PRIOR`)

If a prior design exists in `DESIGN_DIR` and `--yes` is not set, ask first:

> A prior **<prior_format>** design exists for <slug> (<iterations> iteration(s)).
> A) **Evolve** — regenerate content, preserve your canvas layout / section order
> B) **Replace** — start fresh (discards `.design-canvas.state.json` layout)
> C) **Cancel**

Default **Evolve**. On Evolve, read `.design-canvas.state.json` (if present) and pass it
through to Step C so artboard order/labels survive. On Cancel, release the lock and STOP.
With `--yes`, assume **Evolve**.

## B.2 — Source

If `FROM` is unset, ask:

> Where should the design come from?
> A) **From the spec** — generate from the feature's screens + flows (recommended when the spec has screens)
> B) **From mockups** — I have PNG mockups to extract from
> C) **Describe it** — I'll tell you what to build (thin/empty spec)

Bind `source ∈ {spec, png, describe}`. If `source == describe`, gather a short brief
(purpose, audience, visual feel, key screens) — this becomes the generation input and marks
`content_provenance = inferred`. If `source == png` and PNGs exist, Step D will leave
`design-spec.md` to `designer-agent` (precedence).

## B.3 — Format (with a pre-selected recommendation)

If `FORMAT` is unset, compute the recommendation with `lib/design/recommendFormat.mjs`
(`{ screenCount: SCREEN_COUNT, intentText }`), then ask with the recommended option **first
and pre-selected**, labeled by outcome (not jargon):

> <SCREEN_COUNT> screens → **<recommended>** recommended. What should I build?
> A) **Single screen** — one polished page to react to *(prototype)*
> B) **Full flow** — click through every screen in order *(walkthrough)*
> C) **Explore board** — all screens on one zoomable wall; view-only unless saved into the project *(canvas)*

Put the recommended option first with "(recommended — <reason>)". Bind `format`. The user
can always pick another; the recommendation is a default, not a gate.

Return `{ source, format, mode: evolve|replace|fresh, priorState }` to Step C.
