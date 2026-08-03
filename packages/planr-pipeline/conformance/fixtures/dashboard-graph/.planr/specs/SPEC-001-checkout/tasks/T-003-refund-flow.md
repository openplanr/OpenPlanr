---
id: "T-003"
title: "Refund flow"
storyId: "US-001"
specId: "SPEC-001"
slug: "refund-flow"
schemaVersion: "1.0.0"
type: "Tech"
agent: "backend-agent"
status: "blocked"
dependsOn: ["T-002"]
created: "2026-06-13"
updated: "2026-06-13"
---

# T-003 — Refund flow

Blocked task depending on T-002. Exercises the `blocked` status and a
transitive `depends_on` chain (T-003 → T-002 → T-001).
