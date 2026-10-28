---
'@openplanr/canvas': patch
'@openplanr/design': patch
'@openplanr/artifact': patch
'planr-pipeline': patch
'openplanr': patch
---

Canvas wheel and pinch input measures the stage once per gesture instead of on every event. The canvas layer is promoted inside the frame write and demoted only after a zoom settles. The design studio no longer forces a layout while panning and forces far fewer while zooming. Controllers emit a `motion` event when movement starts and stops.

`evaluateCanvasTrace` gates SVG worlds against the SVG diagram tier at 708 and 5,000 elements: renderer main-thread p95 at 8 and 12 ms and no long tasks. Stage DOM, rAF interval and first-frame values for SVG worlds are reported.
