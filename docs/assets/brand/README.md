# OpenPlanr brand assets

The OpenPlanr identity is **Open Decision**: an open planning orbit that resolves
into a diamond decision. The orbit stands for continuous planning and review; the
diamond crossing its boundary stands for an accountable decision becoming action.

These files exist so that documentation, package pages, and integrations can refer
to OpenPlanr accurately. They identify the project and are covered by the
[trademark policy](../../../TRADEMARKS.md), not by the MIT license of the source code.

## Files

| Use | File |
| --- | --- |
| Default mark (teal on any dark surface) | `openplanr-mark.svg` |
| Mark inheriting CSS `color` | `openplanr-mark-currentcolor.svg` |
| Single-color marks | `openplanr-mark-black.svg`, `openplanr-mark-white.svg` |
| Horizontal lockup for dark backgrounds | `openplanr-lockup-on-dark.svg`, `openplanr-lockup-on-dark.png` (1180 × 320) |
| Horizontal lockup for light backgrounds | `openplanr-lockup-on-light.svg`, `openplanr-lockup-on-light.png` (1180 × 320) |
| App icon (rounded tile) | `openplanr-app-icon.svg`, `openplanr-app-icon-maskable.svg`, `png/openplanr-app-icon-*.png` |
| Transparent mark rasters, 16 to 1024 px | `png/openplanr-mark-*.png` |
| Browser and PWA icons | `favicon/` |
| GitHub social preview (2560 × 1280) | `social-preview.png`, source `social-preview.html` |

The lockup SVGs carry live text set in Inter. Use the PNG lockups where the viewer's
fonts cannot be controlled, such as GitHub and npm READMEs.

## Colors

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#08080C` | Backgrounds, text on paper |
| Teal | `#5EEAD4` | The mark, accents on ink |
| Teal on light | `#237A72` | Accents and links on paper (meets contrast requirements) |
| Paper | `#F5F7F7` | Light backgrounds, text on ink |

## Typography

Outfit for headlines, DM Sans for body text, Source Code Pro for code. All three are
open fonts available from Google Fonts. Markdown surfaces use the host's fonts.

## Rules

- Keep the diagonal opening at the upper right; never rotate the mark.
- Keep the diamond and the orbit together as one unit.
- Do not close the orbit, add arrows or checkpoints, or apply gradients.
- Keep clear space of at least one diamond width on every side.
- Minimum size: 24 px for the transparent mark, 16 px for the app tile.
- Use `openplanr-mark-white.svg` or `openplanr-mark-black.svg` when only one color is
  available.

## Using the logo in Markdown

GitHub honors `prefers-color-scheme` inside a `<picture>` element:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/openplanr-lockup-on-dark.png">
  <img alt="OpenPlanr" width="440" src="docs/assets/brand/openplanr-lockup-on-light.png">
</picture>
```

npm renders a single `<img>`; use the self-contained mark there:

```html
<img alt="OpenPlanr" width="72" src="https://raw.githubusercontent.com/openplanr/OpenPlanr/main/docs/assets/brand/openplanr-mark.svg">
```
