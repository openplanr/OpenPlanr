---
"planr-pipeline": minor
---

Diagram engine: lane grammars (`swimlane`, `process`, `kanban`, `user-journey`, `story-map`, `dp-security-matrix`) now render. Lanes are titled bands perpendicular to the flow — rows under `left-right`, columns under `top-down` — each holding its members; a step's position along the flow is its relation rank so handoffs line up across lanes, and a board without relations packs its columns. Relation labels are kept on the path they name and routes no longer ride a run already used by an unrelated relation. The quality report gains `label-edge-distance`, `edge-merge` and `label-cluster-overlap`, and the studio lists lanes in its navigator.
