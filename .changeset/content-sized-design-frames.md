---
'@openplanr/protocol': minor
'@openplanr/design': minor
'openplanr': minor
---

Support content-sized design frames with `height: "auto"`. Size studio boards from rendered content while keeping grid rows stable, preserve numeric feedback coordinates and exports, and audit vertical overflow, positioned content outside frames and root box sizing.

The v1.20.0 design document schema retains `schemaVersion: "1.0.0"`, including auto-height frames. Use `height: "auto"` for pages that scroll. Treat vertical overflow, positioned content outside frames and root box sizing as errors throughout a document with any auto-height frame; all other documents receive warnings that do not block verification or handoff readiness. Layout and schema version never affect severity; migration and dragging preserve fixed-frame warnings.

Ignore legacy personal canvas positions when detecting share updates. Accept existing position-based fingerprints while those positions still match; an older share whose personal positions have since changed can report one update until explicitly republished.
