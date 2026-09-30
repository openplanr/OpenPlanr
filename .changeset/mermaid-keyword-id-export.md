---
"@openplanr/artifact": patch
"planr-pipeline": patch
"openplanr": patch
---

Regenerated Mermaid copies now rename node and group IDs that are Mermaid
keywords, such as `end`, to an unused ID with an underscore suffix. Connections
use the renamed IDs, and the export reports a `keyword-id-renamed` fidelity
notice. This prevents invalid Mermaid output while preserving the editable
bundle's IDs and content.
