---
'@openplanr/protocol': minor
'@openplanr/design': minor
'openplanr': minor
---

Store canvas board positions, optional board titles and section headings in the authored design document. The local studio saves dragged positions to the document and supports undo and redo; portable studios retain moves for the session. Existing documents keep their computed grid unless legacy studio-state or browser positions can fill missing exact board keys. The studio migrates those positions in one layout revision that is not undoable in the session, then removes them from personal state after saving; without a server, they apply for the session only.

The `DESIGN_DOCUMENT_SCHEMA` export now points to the v1.20.0 design document schema. Review bundles retain authored layout and omit legacy personal positions; layout-bearing bundles use the additive v1.20.0 review bundle schema.

The v1.20.0 design contract accepts authored `schemaVersion: "1.0.0"` and `"1.1.0"`, with fixed or auto-height frames in either version. New documents use `"1.1.0"`; existing values and the frozen Protocol 1.9 schema remain unchanged. Vertical overflow, positioned content outside frames and root box sizing are errors for documents authored as `"1.1.0"` or with any auto-height frame, and warnings otherwise. Writing layout never changes severity.

Keep unsaved board moves in the browser draft across reloads and replay their absolute positions against the current layout revision when authored content is unchanged. Report and discard stale moves when authored content changes. Preserve layout save failures and their Retry action over view-context notices; after a studio restart, keep pending moves and offer Reload. Keep the header unsaved until layout recovery completes, and report preview readiness with the revision adopted after legacy layout migration.
