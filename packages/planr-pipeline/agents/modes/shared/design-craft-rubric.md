# Shared: design-craft rubric (single source of truth)

> Used by the `/planr-pipeline:design` generator (`design-step2-generate.md`) **during
> generation** AND **during the self-review pass**. These are the execution-craft rules that
> separate a professional UI from an LLM's first draft — the things a senior designer applies
> automatically. Learned from the UI-UX-Pro-Max skill (MIT) + universal craft, encoded
> natively so planr stays standalone. (SPEC-015 / v0.15.0.)

When designing **for an existing app**, the app's own tokens/components win (see
`design-step2-generate.md` § C.0). This rubric governs **how** you assemble them.

## Spacing & rhythm
- Use **one spacing scale** — `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`. Every margin / padding /
  gap is a value on it. **Never arbitrary** (no `13px`, `17px`, `21px`).
- Equal gaps between sibling items. Section spacing > item spacing (group by proximity).
- Align to a grid / baseline: label, value, and control in a row share a baseline.

## Sizing consistency — the #1 "silly mistake"
- **Same-type elements are the SAME size.** All pills / badges / chips in a group share one
  height + padding. All buttons of one rank share size. All cards in a row share dimensions.
  All inputs in a form share height. Icons come from a fixed set (`16 / 20 / 24`).
- Content length must **not** change an element's height/shape within a group — fix the size;
  truncate or wrap inside. (e.g. an `error` pill and a `warn` pill must be identical in size.)

## Typography
- A type scale (`12 / 14 / 16 / 20 / 24 / 32`), consistent weights, **≤ 2 families**. Body
  14–16px, line-height 1.4–1.6. One text alignment per block (don't mix left/center).

## Color & contrast
- Pull from the **app's tokens** (§ C.0). Text contrast **≥ 4.5:1** (AA); large text ≥ 3:1.
- Semantic colors consistent (error / warn / success = one hue each, everywhere). Reuse
  tokens — no one-off hex. Avoid AI-cliché gradients (purple→pink) unless the app uses them.

## Components & interaction
- Icons are **SVG** (Heroicons / Lucide) — **never emoji as icons**. `cursor: pointer` on all
  clickables. Visible `:focus-visible` on every interactive element. Hover/transitions
  **150–300ms** ease. Respect `prefers-reduced-motion` + `prefers-color-scheme`.

## Alignment, hierarchy & layout
- Optical alignment: edges line up; nothing sits 1–3px off. Group related items (proximity),
  separate unrelated ones (whitespace).
- One clear **primary action** per view; size / weight / color earn attention deliberately.

## Pre-finalize checklist — the self-review audits against THIS
- [ ] All sibling elements of one type are the **same size** (pills, badges, buttons, cards, inputs).
- [ ] Every spacing value is **on the scale**; gaps within a group are equal.
- [ ] Everything **aligns** to a grid/baseline; no 1–3px drift.
- [ ] Type scale + weights consistent; ≤ 2 families; one alignment per block.
- [ ] Contrast ≥ 4.5:1; semantic colors consistent; tokens, not one-off hex.
- [ ] SVG icons (no emoji); `:focus-visible` + hover on interactives; reduced-motion respected.
- [ ] Clear hierarchy; one primary action; consistent, generous whitespace.
