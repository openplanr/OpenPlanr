---
'openplanr': patch
'@openplanr/protocol': patch
---

`delegate` checks a local model server without sending a token: it no longer reads or sends `LM_STUDIO_API_KEY`, `LM_API_TOKEN` or the Claude `ANTHROPIC_AUTH_TOKEN`. A server that requires sign-in is reported as not checked, and the run can still start with the delegated agent's own sign-in.
