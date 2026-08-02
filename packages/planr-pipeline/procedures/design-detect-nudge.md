# Procedure: /plan missing-design nudge (printed, non-interactive)

> Read by `commands/plan.md` Step 1, after mode binding + input validation and **before**
> subagent dispatch. This is a **printed stdout recommendation only** — never an
> `AskUserQuestion`, so `/plan` stays non-interactive and `--dry-run` / CI safe
> (SPEC-015 findings A1 / F7). `/plan` never invokes `/design`.

## When to print

Print the nudge only when BOTH hold:

1. **UI intent** — the spec has screens (a `## Screens` section or `ui_files:` list resolves
   ≥1 screen via the `lib/design/screens.mjs` rules), OR the spec body contains ≥2 UI
   keywords (component, screen, page, form, button, modal, dashboard, layout, nav).
2. **No design yet** — neither a `design-spec.md` (at the mode path) nor any
   `input/ui/*.png` / `<SPEC_DIR>/design/*.png` exists.

If a design already exists, or the feature shows no UI intent, print nothing (silent).

## What to print

Compute the recommended format from the screen count with
`lib/design/recommendFormat.mjs`, then print ONE plain-language line naming the **single**
command (not a multi-option menu):

```
ℹ <slug> looks UI-facing (<N> screens) but has no design yet.
  A <recommended-format> fits best. To generate one (and get UI tasks):
      /planr-pipeline:design <slug>
  Or continue with Tech-only tasks — re-run /plan after adding a design.
```

Do not block. Do not prompt. `/plan` proceeds normally after printing (the specification
agent will emit Tech-only tasks per R2 if the user ignores the nudge). The nudge is a
suggestion consistent with "the agent suggests, then the human triggers the flow".
