---
"@openplanr/artifact": patch
"planr-pipeline": patch
---

Mermaid copy export writes labels with Mermaid's own escapes, so a copy previews again with the same labels. A label such as "Please click here" or "See href list" was exported verbatim, and the Mermaid preview then refused the copy as an unsafe construct; the first letter of `click` or `href` after whitespace is now written as a decimal entity code (`#99;lick`). Double quotes, backslashes and a `#` that would start an entity code are written as `#34;`, `#92;` and `#35;` instead of JSON escapes, which Mermaid does not read. The preview decodes decimal entity codes in labels as Mermaid does, except codes for control characters, which stay literal.
