---
"@openplanr/protocol": minor
"planr-pipeline": minor
"openplanr": minor
---

Add Protocol 1.11 contracts for design handoff readiness, implementation packages, and planning lineage. Design now exposes a deterministic fail-closed readiness compiler, while pipeline and installed OpenPlanr skill packages carry the exact generated contracts for offline validation. The new records authorize only an explicit continuation to Plan; they do not invoke Plan, Ship, Git, release, publication, or deployment actions.
