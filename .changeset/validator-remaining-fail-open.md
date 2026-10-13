---
'@openplanr/protocol': patch
'planr-pipeline': patch
'@openplanr/artifact': patch
'openplanr': patch
---

The JSON Schema validator now reports a `$ref` it cannot resolve, or one that loops, even inside `not`, `if`, `anyOf` or `oneOf`, where it used to pass silently. A supported keyword with a malformed value, such as `minimum: "3"` or `required: "id"`, is now an error instead of being ignored.
