---
'@openplanr/protocol': minor
'@openplanr/design': minor
'openplanr': minor
---

Support content-sized design frames with `height: "auto"`. Size studio boards from rendered content while keeping grid rows stable, preserve numeric feedback coordinates and exports, and audit vertical overflow, positioned content outside frames and root box sizing.

The v1.20.0 design document schema accepts `schemaVersion: "1.0.0"` and `"1.1.0"`, with auto-height frames valid under either value. Author new documents with `"1.1.0"` and preserve existing values. Treat vertical overflow, positioned content outside frames and root box sizing as errors when the authored document uses `"1.1.0"` or any auto-height frame; all other documents receive warnings that do not block verification or handoff readiness. Canvas layout, migration and dragging never change severity or the schema version.

Ignore legacy personal canvas positions when detecting share updates. Accept existing position-based fingerprints while those positions still match; an older share whose personal positions have since changed can report one update until explicitly republished.
