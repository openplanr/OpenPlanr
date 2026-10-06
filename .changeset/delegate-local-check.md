---
'openplanr': patch
'@openplanr/protocol': patch
---

`delegate` checks a local model server without sending a token. A server that requires sign-in is reported as not checked, and the run can still start with the delegated agent's own sign-in.
