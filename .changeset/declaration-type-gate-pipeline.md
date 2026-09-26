---
'planr-pipeline': patch
---

`planr-pipeline/diagram-editor` and `planr-pipeline/diagram-owner` re-export the corrected `@openplanr/artifact` editor declarations: the full `DiagramEditorIconName` union, `DiagramEditorHostPanel.icon`, `save()` failure `status`, `refresh()` conflict `comparison`, the standard stream-reader result union, and `grammar` typed as a `DiagramAuthoringProfile`.
