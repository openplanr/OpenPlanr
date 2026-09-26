---
'@openplanr/artifact': patch
---

The hand-written editor declarations now match their implementations, verified by the new `typecheck:declarations` gate. `DiagramEditorIconName` lists every icon the editor renders (46 names, previously 16), `DiagramEditorHostPanel` declares the `icon` field the mount already validated, `DiagramEditorSession.save()` failures carry the optional `status` they return, `refresh()` conflict failures declare their `comparison`, `DiagramOwnerHttpResponse` readers return the standard `{ done, value }` discriminated union, `DiagramLocalOwnerOptions.grammar` is a `DiagramAuthoringProfile`, and `diagram-authoring` declares the `authoredDiagramPalette`, `renderAuthoredSceneElement` and `resolveDiagramSceneElement` helpers the editor imports. The Mermaid export panel no longer reads a `detail` field that copy diagnostics never carry.
