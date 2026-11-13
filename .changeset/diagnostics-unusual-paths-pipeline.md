---
"planr-pipeline": patch
---

The diagnostics route reports a source path with a colon, a percent sign, a control character or a backslash instead of failing the response. A file whose name or id cannot be a node id, such as one with a backslash or a control character, is reported as an unrecognized identity instead of failing the graph, detail and diagnostics routes.
