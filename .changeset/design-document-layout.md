---
'@openplanr/protocol': minor
'@openplanr/design': minor
'openplanr': minor
---

Store canvas board positions, optional board titles and section headings in the authored design document. The local studio saves dragged positions to the document and supports undo and redo; portable studios retain moves for the session. Existing documents keep their computed grid unless legacy studio-state or browser positions can fill missing exact board keys. The studio migrates those positions in one layout revision that is not undoable in the session, then removes them from personal state after saving; without a server, they apply for the session only.

The `DESIGN_DOCUMENT_SCHEMA` export now points to the v1.20.0 design document schema. Review bundles retain authored layout and omit legacy personal positions; layout-bearing bundles use the additive v1.20.0 review bundle schema.

The v1.20.0 design contract retains authored `schemaVersion: "1.0.0"` for fixed and auto-height frames, and the frozen Protocol 1.9 schema remains unchanged. Vertical overflow, positioned content outside frames and root box sizing are errors throughout a document with any auto-height frame, and warnings otherwise. Layout and schema version never affect severity.

Use a plain studio canvas ground from the theme's stage surface token, preserving board edges and shadows and the diagram editor's dot grid.

Keep unsaved board moves in the browser draft across reloads and replay their absolute positions against the current layout revision when authored content is unchanged. Report and discard stale moves when authored content changes. Preserve layout save failures and their Retry action over view-context notices; after a studio restart, keep pending moves and offer Reload. Keep the header unsaved until layout recovery completes, and report preview readiness with the revision adopted after legacy layout migration.
