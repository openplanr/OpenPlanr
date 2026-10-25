---
"@openplanr/protocol": minor
"@openplanr/design": minor
"@openplanr/artifact": minor
"planr-pipeline": minor
"openplanr": patch
---

Add typed enum and boolean screen props and variant instance values to design
documents at schema version 1.1.0. Render instances from shared sources with root
attributes and classes, validate their values, and retain props in reviews and
handoffs. Prop names and enum values use lowercase tokens so attributes and
classes preserve the same names and values. Existing documents without props
keep their rendering behavior.

Install the updated design skills to author prop-based theme and state variants
without copying source files.
