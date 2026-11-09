---
'openplanr': patch
---

`/release` now does only what you ask. Asking for release notes or a proposed version no longer writes `CHANGELOG.md`, bumps a version or runs tests; those happen when you ask to prepare or cut a release. Collecting changes now reads commit bodies and footers, so a footer-only breaking change is no longer missed, records the base and head revisions, and reports a failing git command instead of treating it as an empty release.
