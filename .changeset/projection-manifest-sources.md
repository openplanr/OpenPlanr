---
"planr-pipeline": minor
---

The protocol projection manifest (`lib/generated/protocol-projection.json`, schema 2.0.0) no longer records a `sha256` per entry; each projected file is checked against its source instead. `registry/v1.5.0/commands.json` and `registry/v1.5.0/skills.json` now declare `protocolVersion` 1.25.0 and carry no `documentDigest`, and `schemas/v1.25.0` adds the matching catalog schemas.
