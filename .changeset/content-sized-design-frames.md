---
'@openplanr/protocol': minor
'@openplanr/design': minor
'openplanr': minor
---

Support content-sized design frames with `height: "auto"`. Size studio boards from rendered content while keeping grid rows stable, preserve numeric feedback coordinates and exports, and audit vertical overflow, positioned content outside frames and root box sizing.

Treat vertical overflow, positioned content outside frames and root box sizing as errors only for documents with a `layout` object or any auto-height frame; older documents receive warnings that do not block verification or handoff readiness.

Ignore legacy personal canvas positions when detecting share updates. Accept existing position-based fingerprints while those positions still match; an older share whose personal positions have since changed can report one update until explicitly republished.
