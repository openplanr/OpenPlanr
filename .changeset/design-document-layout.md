---
'@openplanr/protocol': minor
'@openplanr/design': minor
'openplanr': minor
---

Store canvas board positions, optional board titles and section headings in the authored design document. The local studio saves dragged positions to the document and supports undo and redo; portable studios retain moves for the session. Existing documents keep their computed grid unless legacy studio-state or browser positions can fill missing exact board keys. The studio migrates those positions in one layout revision that is not undoable in the session, then removes them from personal state after saving; without a server, they apply for the session only.

The `DESIGN_DOCUMENT_SCHEMA` export now points to the v1.20.0 design document schema. Review bundles retain authored layout and omit legacy personal positions; layout-bearing bundles use the additive v1.20.0 review bundle schema.
