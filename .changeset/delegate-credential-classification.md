---
'openplanr': patch
'planr-pipeline': patch
'@openplanr/protocol': patch
---

`delegate` classifies credentials by syntax. Member references such as `config!.apiKey` in code, type annotations ending in `;` or `,`, and self-describing test values such as `test_secret_must_be_…` now reach the delegated agent unchanged, while recognizable credentials, private keys and credential files stay blocked. A blocked source lists masked findings with location, rule and confidence; for an optional source they appear only in the prepare preview, never in the delegated context. After you confirm that a specific finding is not a credential, `prepare` accepts it through `credentialResolutions` for those exact bytes only, and the preview lists every accepted resolution.
