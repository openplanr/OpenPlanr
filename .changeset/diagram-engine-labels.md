---
"planr-pipeline": minor
---

Diagram engine: relation labels now sit on the segment that belongs to their own relation (above the arrowhead into the target, or on the source's drop for a fan-in) instead of at a lane midpoint that could land under an unrelated node; inter-layer edges follow the flow axis and prefer a single turn; words are no longer split mid-glyph; flow, message and transition relations render solid and dependency and association dashed, matching common notation; routing lanes clear group frames; and the quality report gains a `label-foreign-node` warning for labels that read as another node's caption.
