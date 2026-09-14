# Shared: design principles — anti-slop, craft discipline (v0.18.0)

> Read by the `/planr-pipeline:design` generate step (C.0) and the design-system
> generator. The **craft rubric** (`design-craft-rubric.md`) governs *measurable*
> craft (spacing scale, sizing consistency, alignment); this file governs the
> *taste* failures that make a design read as machine-generated. Authored natively
> for planr (learned from common design discipline + premium-product practice);
> no external dependency.

## Avoid the machine-generated tells
These are the patterns that instantly signal "an AI made this." Do not emit them:

- **No decorative gradients.** No aggressive multi-stop gradients, no gradient "orbs/blobs"
  to represent AI or as filler. A flat, confident surface beats a gradient wash. (A subtle
  functional gradient — e.g. a sticky-header fade — is fine.)
- **No emoji as UI.** Never emoji for bullets, status, icons, or section markers. Use the
  project's icon set (outline SVG). Emoji in product copy is banned (see brand voice).
- **No rounded-card-with-left-accent-bar cliché** as the default container. Separate with
  hairlines + the elevation ladder; reach for one structure, not a page of identical
  accent-bordered cards.
- **No fake imagery.** No CSS-drawn "product screenshots", no silhouette/placeholder shapes
  standing in for real UI, no stock-y abstract art. Show the real surface, or an honest
  empty/placeholder state — never invented chrome.
- **No centered-everything.** Full pages are laid out in the app shell at real density, not a
  single narrow card centered on empty space (that's a modal, not a screen).

## Content discipline
- **Real content, never lorem.** Names, numbers, statuses, dates come from the spec/brief and
  read like a real workspace. Numbers use `tabular-nums` and align.
- **Copy follows the brand voice** (`brand.md`): sentence case, concise, outcome-first, calm
  errors, no "simply/just/easily", no hype, no emoji.
- **One saturated accent.** Color is information (primary action, status), not decoration. A
  screen with one `--primary` element reads more premium than one with five.

## Craft baseline (enforced + reviewed)
- Everything on the **4-point grid**; same-type elements identical (the linter + craft rubric).
- **AA contrast** on every text/background pair (the linter's `contrast-below-aa` is a hard gate).
- **Optical alignment**, one elevation language, restrained motion (≤260ms, no bounce),
  visible focus ring, `prefers-reduced-motion` honored.
- **Never a blank frame**: skeletons match the real layout; optimistic with honest rollback.

> The test: would a senior product designer ship this screenshot? If any element reads as
> filler, decoration, or a template default, cut it.
