---
'planr-pipeline': patch
---

Dynamic artifacts load again in the local review shell on WebKit-based browsers such as Safari: WebKit applied the shell's `frame-ancestors` directive, which each blob artifact frame inherits, to the artifact frame itself, so the shell refused its own artifacts. The shell no longer sends `frame-ancestors` in its CSP header; `X-Frame-Options: DENY` still keeps it from being framed.
