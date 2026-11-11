---
"@openplanr/protocol": minor
---

Add Protocol 1.25.0 command and skill catalog contracts and export `CATALOG_PROTOCOL_VERSION` from `@openplanr/protocol/browser-contracts`. `registries/commands.json` and `registries/skills.json` now declare `protocolVersion` 1.25.0 and no longer carry a whole-document `documentDigest`; per-entry digests are unchanged. Protocol 1.5.0 catalogs remain accepted.
