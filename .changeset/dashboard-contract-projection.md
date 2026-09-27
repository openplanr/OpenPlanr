---
'planr-pipeline': patch
---

The dashboard contract validators in `lib/dashboard` are generated from `@openplanr/protocol` instead of maintained as separate copies. `closed-json-contract.mjs` now hashes with the Protocol's `sha256Hex` rather than `@noble/hashes`; every content hash and JCS hash is unchanged.
