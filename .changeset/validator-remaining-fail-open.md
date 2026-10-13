---
'@openplanr/protocol': patch
'planr-pipeline': patch
'@openplanr/artifact': patch
'openplanr': patch
---

The JSON Schema validator now reports a `$ref` it cannot resolve, or one that loops, even inside `not`, `if`, `anyOf` or `oneOf`, where it used to pass silently. A supported keyword with a malformed value, such as `minimum: "3"` or `required: "id"`, is now an error instead of being ignored.

A schema that refers to itself now validates data that nests through it, such as a tree of nodes, instead of reporting a circular reference.
