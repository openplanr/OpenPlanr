---
"@openplanr/artifact": patch
"planr-pipeline": patch
---

Split the shared diagram editor into region modules (host options, template, chrome, outline, inspector, canvas, dialogs, commands, keyboard) behind the same `mountDiagramEditor` export and declaration. The editor chrome is built with DOM calls instead of an HTML string and renders the same elements, attributes and order; behaviour is unchanged. The owner runtime bundle grows from 550,201 to 562,225 bytes (116,817 gzipped), within its budget.
