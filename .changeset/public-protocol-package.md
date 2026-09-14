---
"@openplanr/protocol": minor
---

Publish the portable Protocol contracts as the MIT-licensed
`@openplanr/protocol` package. Include the declared JavaScript and type exports,
versioned JSON schemas, registries, and required runtime assets without internal
preservation reports, duplicate pipeline projections, or development files.

Correct `protocolAssetUrl` to resolve the packaged `schemas/v{version}/` path.
Existing CLI and pipeline packages retain their self-contained compatibility
projections; installing the Protocol package does not require a sibling checkout.
