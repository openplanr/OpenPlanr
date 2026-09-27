---
'openplanr': patch
---

JSON the CLI reads from `gh`, `claude` and `codex`, from the credential store and from the published compatibility manifest is now validated against a schema where it is parsed. A malformed or changed payload fails with `E_EXTERNAL_JSON_INVALID`, naming the command or file and each offending field, instead of a `TypeError` deep in a service; credential documents never echo their contents in the message. A legacy `~/.planr/credentials.json` that cannot be read is now kept for a later migration instead of being deleted as empty, and an off-schema compatibility manifest is ignored rather than cached.
