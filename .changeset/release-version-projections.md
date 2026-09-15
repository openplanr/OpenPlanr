---
"planr-pipeline": patch
---

Keep release diagnostics valid after package version updates. Runtime adapter version projections now follow the declared pipeline package version, while preserved adapter contracts and document schema versions remain unchanged. Doctor validates package identity and canonical schema ownership without requiring package version numbers in documentation prose.
