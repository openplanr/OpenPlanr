---
name: {{ALIAS_ID}}
description: {{DESCRIPTION}}
license: MIT
---

# OpenPlanr compatibility router

This alias preserves legacy invocation only. Route the request to exactly one
canonical skill; the canonical `planr-*` source owns the workflow.

{{ROUTING_TABLE}}

Do not implement a second workflow or add lifecycle machinery in this alias.
Follow the selected canonical skill as written, preserve the user's scope, and
pause only at the real effect boundaries that skill identifies.
