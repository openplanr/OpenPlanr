---
'@openplanr/artifact': patch
'planr-pipeline': patch
---

The diagram engine gains the `openplanr` brand theme. `theme.themeId: "openplanr"` renders Ink text with teal-on-light accents on Paper in `light` mode and Paper text with Teal accents on Ink in `dark` mode; fills, strokes, group outlines, and labels are blended from those four brand tokens and every text colour meets WCAG AA. `auto` mode emits one SVG whose inline `prefers-color-scheme` stylesheet follows the viewer, while the PNG and the review studio keep the light values. The manifest and asset receipt record the theme that produced a set, Mermaid rerenders keep the document's theme mode, and an unknown theme id is now rejected instead of silently rendering the default palette. `openplanr-default` output is byte-for-byte unchanged.
