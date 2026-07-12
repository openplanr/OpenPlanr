---
name: planr-ship
description: Execute a reviewed OpenPlanr feature through DEV, QA, and finalization.
license: MIT
---

Require a separate explicit SHIP request after PLAN review. Run
`planr pipeline ship <feature>`, execute ready tasks in dependency order, use native
subagents when available and sequential fallback otherwise, enforce role and Preserve
boundaries, cap correction attempts at three, run build/test plus QA, and finalize
manifests, provenance, and the shipped marker.
