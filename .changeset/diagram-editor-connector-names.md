---
"@openplanr/artifact": patch
"planr-pipeline": patch
---

Diagram editor: an unlabelled connector is named by its endpoints, such as "Start → Process", instead of by its internal id. The name appears in the outline, the inspector title, the delete confirmation and the status line, which now reads "Selected: Start → Process · 5 objects" for a single selection; screen readers hear "Start → Process, Connector". The Label field shows only a stored label, with the derived name as a placeholder, so applying other connector properties no longer writes the id onto the canvas as a label. The inspector header no longer repeats the selected object's id; it stays under Advanced. Delete confirmation uses real plurals ("Delete 5 objects, including 2 connectors?", "Delete 1 connector?") and lists the affected connectors by name. "Start blank" now closes the start card, which stays closed for the rest of the session once the author starts blank, applies the template or creates a shape. Field placeholders use the editor's muted text colour (4.99:1 light, 7.72:1 dark); the browser defaults fell below 4.5:1, down to 2.35:1 in WebKit.
